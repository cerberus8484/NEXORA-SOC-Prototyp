'use strict';

// ─────────────────────────────────────────────────────────────────────────
// SSRF-Vorprüfung: WARUM wurde blockiert?
//
// `isBlockedSsrfUrlResolved()` liefert nur true/false. Die Routen machten daraus
// pauschal „Ziel-URL nicht erlaubt (Loopback/Metadaten)" — auch dann, wenn der
// Hostname schlicht NICHT AUFLÖSBAR war (Tippfehler, oder ein interner Name, den
// der Container nicht auflösen kann). Ein Admin sucht den Fehler dann an der
// völlig falschen Stelle.
//
// Das Blockieren bleibt (fail-closed ist richtig — bei IMAP ist die Vorprüfung
// sogar die EINZIGE Absicherung, weil dort kein HTTP-Connect-Guard greift).
// Neu ist nur: der Grund wird benannt.
// ─────────────────────────────────────────────────────────────────────────

const { ssrfBlockReason } = require('../../src/integrations/http/internalUrlAllowlist');

describe('ssrfBlockReason — Grund statt bloßem true/false', () => {
  test('Loopback → policy (echtes SSRF-Risiko)', async () => {
    expect(await ssrfBlockReason('https://127.0.0.1')).toBe('policy');
    expect(await ssrfBlockReason('https://localhost')).toBe('policy');
  });

  test('Cloud-Metadaten-Adresse → policy', async () => {
    expect(await ssrfBlockReason('https://169.254.169.254/latest/meta-data')).toBe('policy');
  });

  test('nicht auflösbarer Host → unresolvable (NICHT als Loopback ausgeben)', async () => {
    const r = await ssrfBlockReason('https://gibt-es-garantiert-nicht.invalid');
    expect(r).toBe('unresolvable');
  });

  test('unparsebare URL → policy (fail-closed)', async () => {
    expect(await ssrfBlockReason('kein-url')).toBe('policy');
  });

  test('leere Eingabe → null (nichts zu prüfen)', async () => {
    expect(await ssrfBlockReason('')).toBeNull();
    expect(await ssrfBlockReason(undefined)).toBeNull();
  });

  test('bleibt deckungsgleich mit isBlockedSsrfUrlResolved (keine Schutzlücke)', async () => {
    const { isBlockedSsrfUrlResolved } = require('../../src/integrations/http/internalUrlAllowlist');
    for (const u of ['https://127.0.0.1', 'https://169.254.169.254', 'https://gibt-es-garantiert-nicht.invalid', 'kein-url']) {
      const blocked = await isBlockedSsrfUrlResolved(u);
      const reason  = await ssrfBlockReason(u);
      expect(Boolean(reason)).toBe(blocked);   // gleiche Entscheidung, nur mit Begründung
    }
  });
});
