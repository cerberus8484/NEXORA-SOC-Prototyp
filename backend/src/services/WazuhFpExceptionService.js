'use strict';

const crypto = require('crypto');
const B = require('../integrations/adapters/wazuh/wazuhRuleExceptionBuilder');
const { WazuhFpException } = require('../domain/WazuhFpException');

const sha = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 32);
const now = () => new Date().toISOString();

/**
 * WazuhFpExceptionService — Apply/Restart/Revert für scoped FP-Ausnahmen.
 *
 * Sicherheits-Invarianten:
 *  - Guardrails erneut server-seitig (keine globale Ausnahme).
 *  - Idempotenz über scopeHash (Repo) + File-Scan (Quelle der Wahrheit).
 *  - apply schreibt + validiert, setzt status=restart_required — KEIN Auto-Restart.
 *  - validateConfiguration KO → Rollback auf beforeContent, status=failed, kein Restart.
 *  - restart/revert sind getrennte, explizite Schritte.
 *  - Alles auditiert (before/after-Hash, scope, ids).
 */
class WazuhFpExceptionService {
  constructor({ repo, apiClient, audit, builder = B, applyEnabled = false } = {}) {
    this._repo = repo;
    this._api = apiClient;
    this._audit = audit;
    this._b = builder;
    this._applyEnabled = applyEnabled; // SAFETY GATE — default unscharf
  }

  async getForTicket(ticketId) { return this._repo.findByTicket(ticketId); }

  // ── FORWARD: Analyst erstellt + leitet weiter (Status submitted, KEIN Write) ──
  // Erzeugt die scoped Regel-Vorschau und persistiert sie zur Freigabe durch
  // Engineer/Admin. Es wird NICHTS nach Wazuh geschrieben.
  async forward({ ticketId, scope = {}, actor = {} }) {
    const { errors } = this._b.validateScope(scope);
    if (errors.length) return { ok: false, errors };

    const hash = this._b.scopeHash(scope);
    const dup = await this._repo.findActiveByScopeHash?.(hash);
    if (dup) { await this._writeAudit('FP_FORWARD_DUPLICATE', actor, dup, { idempotent: true }); return { ok: true, idempotent: true, exception: dup }; }

    const built = this._b.buildFpException({ ...scope, ticketId });
    if (!built.ok) return { ok: false, errors: built.errors };

    const ex = await this._repo.create(WazuhFpException.create({
      ticketId, parentRuleId: scope.ruleId, generatedRuleId: built.ruleId,
      srcips: scope.srcips, dstips: scope.dstips, dstports: scope.dstports,
      protocol: scope.protocol, agentId: scope.agentId, reason: scope.reason,
      scopeHash: hash, xml: built.xml, file: built.file, status: 'submitted',
      createdBy: actor.id,
    }));
    await this._writeAudit('FP_FORWARD', actor, ex, { generatedRuleId: built.ruleId });
    return { ok: true, exception: ex };
  }

  // ── QUICK: rollenabhängiger Ein-Klick aus dem Ticket ─────────────────────
  // Engineer/Admin bei scharfem Safety-Gate → apply (Write). Sonst (Analyst,
  // oder Gate aus) → forward (kein Write, kein Dead-End). Delegiert bewusst an
  // die geprüften Pfade — KEINE neue Wazuh-Logik. Liefert action für die UI.
  async quick({ ticketId, scope = {}, actor = {} }) {
    const role = String(actor.role || '');
    const canApply = role === 'engineer' || role === 'admin';
    if (canApply && this._applyEnabled) {
      const r = await this.apply({ ticketId, scope, actor });
      return { ...r, action: 'applied' };
    }
    const r = await this.forward({ ticketId, scope, actor });
    return { ...r, action: 'forwarded' };
  }

  // Capability-Info fürs Frontend (kein Schreibzugriff).
  capabilities() {
    return { applyEnabled: !!this._applyEnabled, apiConfigured: !!this._api?.isEnabled?.() };
  }

  // Kill-Switch: ohne WAZUH_FP_APPLY_ENABLED=true ist jeder Schreibpfad blockiert.
  _gated() {
    if (this._applyEnabled) return null;
    return { ok: false, disabled: true, errors: ['Wazuh FP apply is disabled by configuration'] };
  }

  _roleGate(actor = {}, allowed = []) {
    const role = String(actor.role || '');
    if (allowed.includes(role)) return null;
    return { ok: false, errors: ['Rolle darf diese Wazuh-FP-Aktion nicht ausfuehren'] };
  }

  // Schreibt die Regeldatei — oder LÖSCHT sie, wenn keine <rule> mehr übrig ist.
  // Wazuh lehnt eine leere Regelgruppe ab (PUT würde still scheitern und die
  // alte Datei stehen lassen) → beim Entfernen der letzten Regel muss gelöscht
  // werden. before='' (Datei existierte nie) wird beim Rollback ebenfalls zum Delete.
  async _persist(file, content) {
    if (/<rule\b/i.test(String(content))) return this._api.putRuleFile(file, content);
    if (typeof this._api.deleteRuleFile === 'function') return this._api.deleteRuleFile(file);
    return this._api.putRuleFile(file, content);
  }

  async _writeAudit(action, actor, ex, extra = {}) {
    if (!this._audit) return;
    try {
      await this._audit.write({
        actorUserId: actor?.id || null,
        actorLabel: actor?.label || '',
        action,
        targetType: 'wazuh_fp_exception',
        targetId: ex?.id || '',
        metadata: {
          role: actor?.role || '',
          ticketId: ex?.ticketId || '',
          parentRuleId: ex?.parentRuleId || '',
          generatedRuleId: ex?.generatedRuleId ?? null,
          scopeHash: ex?.scopeHash || '',
          status: ex?.status || '',
          ...extra,
        },
      });
    } catch { /* Audit darf den Vorgang nicht brechen */ }
  }

  // ── APPLY: Datei schreiben + validieren, KEIN Restart ─────────────────────
  async apply({ ticketId, scope = {}, actor = {} }) {
    const gate = this._gated(); if (gate) return gate;
    const roleGate = this._roleGate(actor, ['engineer', 'admin']); if (roleGate) return roleGate;
    const { errors } = this._b.validateScope(scope);
    if (errors.length) return { ok: false, errors };

    const hash = this._b.scopeHash(scope);
    const file = B.GROUP_FILE;

    // Idempotenz (Repo)
    const dup = await this._repo.findActiveByScopeHash(hash);
    if (dup) { await this._writeAudit('FP_APPLY_DUPLICATE', actor, dup, { idempotent: true }); return { ok: true, idempotent: true, exception: dup }; }

    if (!this._api.isEnabled?.()) return { ok: false, errors: ['Wazuh-API nicht konfiguriert (WAZUH_API_*)'] };

    const before = await this._api.getRuleFile(file);
    const beforeHash = sha(before);

    // Idempotenz (Datei = Quelle der Wahrheit): Scope bereits als Regel vorhanden?
    const existingId = this._b.findRuleByScope(before, scope);
    if (existingId) {
      const adopted = await this._repo.create(WazuhFpException.create({
        ticketId, parentRuleId: scope.ruleId, generatedRuleId: existingId,
        srcips: scope.srcips, dstips: scope.dstips, dstports: scope.dstports, protocol: scope.protocol, agentId: scope.agentId,
        reason: scope.reason, scopeHash: hash, file, status: 'active', createdBy: actor.id, approvedBy: actor.id, beforeHash,
      }));
      await this._writeAudit('FP_APPLY_ADOPTED', actor, adopted, { idempotent: true, generatedRuleId: existingId });
      return { ok: true, idempotent: true, exception: adopted };
    }

    const ruleId = this._b.allocateRuleId(before);
    const ruleEl = this._b.buildRuleElement(scope, ruleId, hash);
    // GUARDRAIL: ohne echten Selector (srcip/dstip/hostname) würde die Regel die
    // Eltern-Regel GLOBAL abschalten — z.B. Agent-Scope nur mit ID, ohne Namen.
    if (!this._b.ruleElementHasSelector(ruleEl)) {
      await this._writeAudit('FP_APPLY_BLOCKED', actor, { ticketId, scopeHash: hash }, { reason: 'no_selector' });
      return { ok: false, errors: ['Agent-scoped Ausnahme ohne verifizierbaren Selector (hostname fehlt) — Apply blockiert, Syntax-Verifikation nötig.'] };
    }
    const after  = this._b.insertRule(before, ruleEl);
    const afterHash = sha(after);

    let ex = await this._repo.create(WazuhFpException.create({
      ticketId, parentRuleId: scope.ruleId, generatedRuleId: ruleId,
      srcips: scope.srcips, dstips: scope.dstips, dstports: scope.dstports, protocol: scope.protocol, agentId: scope.agentId,
      reason: scope.reason, scopeHash: hash, xml: ruleEl, file, status: 'draft',
      createdBy: actor.id, approvedBy: actor.id, beforeHash,
    }));

    // Schreiben
    try {
      await this._persist(file, after);
    } catch (err) {
      ex = await this._repo.update(ex.id, { status: 'failed', lastError: err.message });
      await this._writeAudit('FP_APPLY_FAILED', actor, ex, { error: err.message, result: 'failed' });
      return { ok: false, errors: [`Schreiben fehlgeschlagen: ${err.message}`], exception: ex, retryable: true };
    }

    // Validieren — KO → Rollback, kein Restart
    const v = await this._api.validateConfiguration();
    if (!v.ok) {
      try { await this._persist(file, before); } catch { /* best effort rollback */ }
      ex = await this._repo.update(ex.id, { status: 'failed', lastError: `validation ${v.status}` });
      await this._writeAudit('FP_APPLY_ROLLBACK', actor, ex, { validation: v.status, beforeHash, afterHash, result: 'rolled_back' });
      return { ok: false, errors: [`Validierung fehlgeschlagen (${v.status}) — zurückgerollt, kein Restart`], exception: ex };
    }

    ex = await this._repo.update(ex.id, { status: 'restart_required', afterHash, appliedAt: now() });
    await this._writeAudit('FP_APPLY', actor, ex, { beforeHash, afterHash, generatedRuleId: ruleId, managerRestartRequested: true, result: 'ok' });
    return { ok: true, exception: ex, restartRequired: true };
  }

  // ── RESTART: expliziter, separater Schritt ───────────────────────────────
  async restart({ exceptionId, actor = {} }) {
    const gate = this._gated(); if (gate) return gate;
    const roleGate = this._roleGate(actor, ['admin']); if (roleGate) return roleGate;
    const ex = await this._repo.findById(exceptionId);
    if (!ex) return { ok: false, errors: ['Exception nicht gefunden'] };
    if (!this._api.isEnabled?.()) return { ok: false, errors: ['Wazuh-API nicht konfiguriert'] };
    try {
      await this._api.restartManager();
    } catch (err) {
      await this._writeAudit('FP_RESTART_FAILED', actor, ex, { error: err.message, result: 'failed' });
      return { ok: false, errors: [`Manager-Restart fehlgeschlagen: ${err.message}`], retryable: true };
    }
    const next = ex.status === 'reverted' ? 'reverted' : 'active';
    const updated = await this._repo.update(exceptionId, { status: next });
    await this._writeAudit('FP_RESTART', actor, updated, { managerRestartCompleted: true, result: 'ok' });
    return { ok: true, exception: updated };
  }

  // ── REVERT: Regel entfernen (Restart bleibt separat) ─────────────────────
  async revert({ exceptionId, actor = {} }) {
    const gate = this._gated(); if (gate) return gate;
    const roleGate = this._roleGate(actor, ['admin']); if (roleGate) return roleGate;
    const ex = await this._repo.findById(exceptionId);
    if (!ex) return { ok: false, errors: ['Exception nicht gefunden'] };
    if (!this._api.isEnabled?.()) return { ok: false, errors: ['Wazuh-API nicht konfiguriert'] };

    const before = await this._api.getRuleFile(ex.file);
    const block = this._b.findRuleById(before, ex.generatedRuleId);
    if (!block) {
      const updated = await this._repo.update(exceptionId, { status: 'reverted', revertedAt: now() });
      await this._writeAudit('FP_REVERT_NOOP', actor, updated, { note: 'rule already absent' });
      return { ok: true, exception: updated, restartRequired: false };
    }
    // Sicherheits-Quergegencheck: Marker muss zum Datensatz passen
    if (ex.scopeHash && !block.includes(`scope=${ex.scopeHash}`)) {
      await this._writeAudit('FP_REVERT_ABORTED', actor, ex, { reason: 'marker_mismatch' });
      return { ok: false, errors: ['Marker-Mismatch — Regel passt nicht zum Datensatz, Revert abgebrochen'] };
    }

    const after = this._b.removeRuleById(before, ex.generatedRuleId);
    try {
      await this._persist(ex.file, after);
    } catch (err) {
      await this._writeAudit('FP_REVERT_FAILED', actor, ex, { error: err.message, result: 'failed' });
      return { ok: false, errors: [`Entfernen fehlgeschlagen: ${err.message}`], retryable: true };
    }
    const v = await this._api.validateConfiguration();
    if (!v.ok) {
      try { await this._persist(ex.file, before); } catch { /* best effort */ }
      await this._writeAudit('FP_REVERT_ROLLBACK', actor, ex, { validation: v.status, result: 'rolled_back' });
      return { ok: false, errors: [`Validierung nach Revert KO (${v.status}) — zurückgerollt`] };
    }
    const updated = await this._repo.update(exceptionId, { status: 'reverted', revertedAt: now(), afterHash: sha(after) });
    await this._writeAudit('FP_REVERT', actor, updated, { beforeHash: sha(before), managerRestartRequested: true, result: 'ok' });
    return { ok: true, exception: updated, restartRequired: true };
  }
}

module.exports = { WazuhFpExceptionService };
