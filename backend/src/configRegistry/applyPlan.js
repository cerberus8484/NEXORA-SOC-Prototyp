'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 1 — separate Validierung + redigiertes Apply-Plan-Artefakt.
//
// Reines Modul (keine DB, kein HTTP, KEINE Ausführung). Erzeugt Transparenz:
//   Was würde sich ändern? Welcher Service-Impact wäre zu erwarten? Was bliebe gleich?
// — OHNE irgendetwas anzuwenden. `applyStatus` bleibt 'not_supported', `wouldApply`
// ist IMMER false. Der Plan ist ein Vorschau-Artefakt, kein Apply-Befehl.
//
// Sensible Felder werden in jedem Ausgabepfad (Validierung, before/after, Diff) redigiert.
// ─────────────────────────────────────────────────────────────────────────

/** Baseline aus den Capability-Defaults (es existiert KEIN angewendeter Wert). */
function defaultsOf(capability) {
  const out = {};
  for (const f of capability.fields()) {
    if (f.default !== undefined) out[f.name] = f.default;
  }
  return out;
}

/** Nicht-werfende Validierung → strukturiertes, redigiertes Ergebnis. */
function validateValue(capability, value) {
  return capability.tryValidate(value);
}

/** Redigierten Vorher/Nachher-Diff bilden (changed + unchanged getrennt). */
function diff(beforeRedacted, afterRedacted) {
  const keys = new Set([...Object.keys(beforeRedacted || {}), ...Object.keys(afterRedacted || {})]);
  const changes = [];
  const unchanged = [];
  for (const key of keys) {
    const b = beforeRedacted ? beforeRedacted[key] : undefined;
    const a = afterRedacted ? afterRedacted[key] : undefined;
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ key, before: b, after: a });
    else unchanged.push({ key, value: a });
  }
  return { changes, unchanged };
}

/**
 * Redigiertes Apply-Plan-Artefakt. KEIN Apply — beschreibt nur, was passieren WÜRDE.
 * @param {object} p.capability ConfigCapability
 * @param {string} p.targetId   Zielinstanz (Allowlist)
 * @param {object} p.before     Baseline (z. B. Defaults) — wird redigiert
 * @param {object} p.after      gewünschter Wert (Draft) — wird redigiert
 */
function buildApplyPlan({ capability, targetId, before, after } = {}) {
  if (!capability) throw new Error('buildApplyPlan: capability erforderlich');
  const beforeRedacted = capability.redact(before || {});
  const afterRedacted = capability.redact(after || {});
  const { changes, unchanged } = diff(beforeRedacted, afterRedacted);
  return {
    capabilityId: capability.id,
    targetId: targetId || null,
    applyImpact: capability.applyImpact,        // erwarteter Service-Impact (none|reload|restart)
    applyStatus: capability.applyStatus,        // 'not_supported' — kein Apply-Kanal
    applyEligible: capability.applyEligible,    // dürfte SPÄTER mal angewendet werden
    wouldApply: false,                          // diese Stufe wendet NICHTS an
    before: beforeRedacted,
    after: afterRedacted,
    changes,
    unchanged,
    note: capability.applyEligible
      ? 'Vorschau. Diese Capability ist grundsätzlich apply-fähig, aber es wird nichts angewendet (kein kontrollierter Apply-Kanal in dieser Stufe).'
      : 'Vorschau. Diese Capability ist NICHT für eine Anwendung vorgesehen — sie bleibt dauerhaft nur konfigurierbar, nicht anwendbar.',
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { defaultsOf, validateValue, buildApplyPlan };
