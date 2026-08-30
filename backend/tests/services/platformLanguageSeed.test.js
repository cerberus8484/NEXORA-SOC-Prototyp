'use strict';

// Die Plattform-Sprache aus den Systemeinstellungen war eine Attrappe.
//
// Der Schalter "Sprache" unter Systemeinstellungen liess sich speichern, aber
// NICHTS im Code hat ihn je gelesen -- der Wert kam im gesamten Frontend genau
// einmal vor, naemlich an der Auswahlliste selbst. Ein Admin stellte "English"
// ein und es passierte nichts.
//
// Wirksam ist die Sprache PRO BENUTZER (users.language, vom LanguageProvider
// gelesen). Die Spalte ist NOT NULL DEFAULT 'de' -- jeder Benutzer hat also
// immer einen expliziten Wert, weshalb ein "Plattform-Standard" als Fallback
// per Konstruktion nie greifen koennte. Der einzige Zeitpunkt, an dem er
// ueberhaupt wirken kann, ist die ANLAGE eines Benutzers.

jest.mock('../../src/domain/passwordPolicyLoader', () => {
  const actual = jest.requireActual('../../src/domain/passwordPolicyLoader');
  return { ...actual, loadPlatformLanguage: jest.fn() };
});

const { loadPlatformLanguage } = require('../../src/domain/passwordPolicyLoader');
const { authService } = require('../../src/services/AuthService');

beforeEach(() => {
  authService._users.clear();
  jest.clearAllMocks();
});

describe('Plattform-Sprache bei der Benutzeranlage', () => {
  test('neuer Benutzer erhaelt die eingestellte Plattform-Sprache', async () => {
    loadPlatformLanguage.mockResolvedValue('en');

    await authService.register({
      email: 'neu@test.soc', displayName: 'Neu', password: 'StartPw1!', role: 'analyst',
    });

    const user = await authService._findByEmail('neu@test.soc');
    expect(user.language).toBe('en');
  });

  test('eine ausdruecklich uebergebene Sprache schlaegt die Plattform-Vorgabe', async () => {
    loadPlatformLanguage.mockResolvedValue('en');

    await authService.register({
      email: 'de@test.soc', displayName: 'DE', password: 'StartPw1!', role: 'analyst',
      language: 'de',
    });

    const user = await authService._findByEmail('de@test.soc');
    expect(user.language).toBe('de');
  });

  test('faellt auf Deutsch zurueck, wenn die Einstellung nicht lesbar ist', async () => {
    // Fail-safe: Eine kaputte Einstellung darf die Benutzeranlage nicht kippen.
    loadPlatformLanguage.mockResolvedValue(undefined);

    await authService.register({
      email: 'fallback@test.soc', displayName: 'FB', password: 'StartPw1!', role: 'analyst',
    });

    const user = await authService._findByEmail('fallback@test.soc');
    expect(user.language).toBe('de');
  });
});
