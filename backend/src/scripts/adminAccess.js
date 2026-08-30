'use strict';

// Admin-Zugang herstellen — der einzige CLI-Pfad, der ein Admin-Konto anfassen darf.
//
// Zwei Modi, bewusst getrennt:
//   --ensure  legt den Admin NUR an, wenn er fehlt. Beruehrt ein vorhandenes Konto
//             nicht und meldet das ueber den Exit-Code. Das ist der Weg, den der
//             Installer bei JEDEM Lauf geht.
//   --reset   setzt das Passwort eines VORHANDENEN Kontos neu (Recovery). Nur auf
//             ausdrueckliche Anforderung (install.sh --reset-admin-password), damit
//             eine Wiederholungs-Installation nicht stillschweigend die Zugangsdaten
//             eines laufenden Systems rotiert.
//
// Zusatzschalter zu --reset:
//   --no-force-change   setzt das Passwort OHNE erzwungenen Wechsel beim naechsten
//             Login. Gedacht fuer den Fall, dass jemand am Wechsel-Formular selbst
//             haengenbleibt -- ein normaler --reset wuerde ihn genau dorthin
//             zuruecksschicken. Bewusst opt-in: der Regelfall bleibt der erzwungene
//             Wechsel, denn ein Passwort, das ein Zweiter kennt, soll nicht bleiben.
//
// Warum es das ueberhaupt braucht: Das Bootstrap-Passwort wird nach der Installation
// aus der .env entfernt. Wird spaeter das DB-Volume geloescht, die .env aber behalten,
// dann ueberspringt der Start-Bootstrap mangels ADMIN_PASSWORD das Anlegen — die
// Installation meldet Erfolg und hat KEIN Admin-Konto. Genau diese Luecke schliesst
// der --ensure-Lauf.
//
// Passwort kommt ueber stdin, damit es weder in argv noch in der Prozess-Umgebung
// steht (beides waere per `ps` fuer andere Nutzer lesbar):
//   printf '%s' "$PW" | node src/scripts/adminAccess.js --ensure
//
// Exit-Codes (der Installer wertet sie aus):
//   0 = Konto wurde angelegt bzw. Passwort gesetzt
//   2 = --ensure: Konto war bereits vorhanden, nichts geaendert
//   1 = Fehler
//
// Loggt niemals das Passwort.

require('dotenv').config();

const config = require('../config');
const { authService } = require('../services/AuthService');

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_UNCHANGED = 2;

/** Liest das Passwort von stdin — leer, wenn kein Pipe-Input anliegt. */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    process.stdin.on('error', () => resolve(''));
  });
}

(async () => {
  try {
    const args = process.argv.slice(2);
    const mode = args.includes('--reset') ? 'reset' : 'ensure';
    const email = args.find((a) => !a.startsWith('--')) || process.env.ADMIN_EMAIL;
    const password = (await readStdin()) || process.env.ADMIN_PASSWORD || '';

    if (!email) {
      console.error('Keine Ziel-Adresse: ADMIN_EMAIL setzen oder als Argument uebergeben.');
      process.exit(EXIT_ERROR);
    }
    if (!password) {
      console.error('Kein Passwort: ueber stdin einpipen oder ADMIN_PASSWORD setzen.');
      process.exit(EXIT_ERROR);
    }

    if (config.db.enabled) {
      const { migrate } = require('../db/pool');
      await migrate();
    }

    if (mode === 'reset') {
      const forceChange = !args.includes('--no-force-change');
      const res = await authService.resetPasswordByEmail({
        email, newPassword: password, mustChangePassword: forceChange,
      });
      console.log(`Passwort zurueckgesetzt: ${res.email} (${
        forceChange ? 'Wechsel beim naechsten Login erzwungen' : 'sofort nutzbar, KEIN erzwungener Wechsel'
      })`);
      process.exit(EXIT_OK);
    }

    const res = await authService.ensureAdminUser({ email, password });
    if (res.created) {
      console.log(`Admin angelegt: ${res.email} (Wechsel beim ersten Login erzwungen)`);
      process.exit(EXIT_OK);
    }
    console.log(`Admin existiert bereits: ${res.email} — unveraendert.`);
    process.exit(EXIT_UNCHANGED);
  } catch (err) {
    // Nur die Meldung — niemals das Passwort.
    console.error('Admin-Zugang fehlgeschlagen:', err.message);
    process.exit(EXIT_ERROR);
  }
})();
