'use strict';

// Administrativer Passwort-Reset (CLI-Recovery-Pfad).
//
// Hintergrund: Das Bootstrap-Passwort wird nach der Installation bewusst von der
// Platte entfernt. Ohne diesen Pfad war ein verlorenes Admin-Passwort endgueltig —
// `seed:admin` ist idempotent und ruehrt ein bestehendes Konto NICHT an.

const { authService } = require('../../src/services/AuthService');

beforeEach(() => {
  authService._users.clear();
});

describe('AuthService.resetPasswordByEmail', () => {
  test('setzt das Passwort ohne Kenntnis des alten', async () => {
    await authService.register({ email: 'admin@test.soc', displayName: 'A', password: 'AltesPw1!', role: 'admin' });

    await authService.resetPasswordByEmail({ email: 'admin@test.soc', newPassword: 'NeuesPw2!' });

    const session = await authService.login({ email: 'admin@test.soc', password: 'NeuesPw2!' });
    expect(session.token).toBeDefined();
  });

  test('altes Passwort gilt danach nicht mehr', async () => {
    await authService.register({ email: 'admin@test.soc', displayName: 'A', password: 'AltesPw1!', role: 'admin' });

    await authService.resetPasswordByEmail({ email: 'admin@test.soc', newPassword: 'NeuesPw2!' });

    await expect(authService.login({ email: 'admin@test.soc', password: 'AltesPw1!' }))
      .rejects.toThrow();
  });

  test('erzwingt Passwortwechsel beim naechsten Login', async () => {
    await authService.register({ email: 'admin@test.soc', displayName: 'A', password: 'AltesPw1!', role: 'admin' });

    await authService.resetPasswordByEmail({ email: 'admin@test.soc', newPassword: 'NeuesPw2!' });

    const user = await authService._findByEmail('admin@test.soc');
    expect(user.mustChangePassword).toBe(true);
  });

  test('mustChangePassword:false uebergibt ein sofort nutzbares Passwort', async () => {
    // Recovery-Fall: Wer sich am erzwungenen Wechsel-Formular aussperrt, braucht
    // einen Zugang, der NICHT wieder auf demselben Formular landet.
    await authService.register({ email: 'admin@test.soc', displayName: 'A', password: 'AltesPw1!', role: 'admin' });

    await authService.resetPasswordByEmail({
      email: 'admin@test.soc', newPassword: 'NeuesPw2!', mustChangePassword: false,
    });

    const user = await authService._findByEmail('admin@test.soc');
    expect(user.mustChangePassword).toBe(false);

    // und das Passwort funktioniert wirklich
    const res = await authService.login({ email: 'admin@test.soc', password: 'NeuesPw2!' });
    expect(res.user.email).toBe('admin@test.soc');
  });

  test('unbekannte E-Mail → Fehler statt stiller No-op', async () => {
    await expect(authService.resetPasswordByEmail({ email: 'niemand@test.soc', newPassword: 'NeuesPw2!' }))
      .rejects.toThrow(/niemand@test.soc/);
  });

  test('schwaches Passwort wird abgelehnt (Policy gilt auch hier)', async () => {
    await authService.register({ email: 'admin@test.soc', displayName: 'A', password: 'AltesPw1!', role: 'admin' });

    await expect(authService.resetPasswordByEmail({ email: 'admin@test.soc', newPassword: 'kurz' }))
      .rejects.toThrow();
  });

  test('deaktiviertes Konto → Fehler, statt ein totes Passwort zu setzen', async () => {
    await authService.register({ email: 'admin@test.soc', displayName: 'A', password: 'AltesPw1!', role: 'admin' });
    const user = await authService._findByEmail('admin@test.soc');
    user.isActive = false;
    await authService._users.save(user);

    await expect(authService.resetPasswordByEmail({ email: 'admin@test.soc', newPassword: 'NeuesPw2!' }))
      .rejects.toThrow(/deaktiviert/i);
  });
});
