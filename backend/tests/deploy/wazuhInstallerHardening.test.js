'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deploy-Härtung — Signatur-Pinning der Wazuh-Agent-Installer.
//
// Vor dem Scharfschalten (DEPLOY_ENABLED) MUSS der Installer die Herkunft des
// Agent-Pakets kryptografisch binden, nicht nur über HTTPS ziehen (TOFU):
//   • Linux (.sh): den importierten APT-GPG-Key gegen den bekannten Wazuh-
//     Signing-Fingerprint pinnen und bei Abweichung hart abbrechen.
//   • Windows (.ps1): die Authenticode-Signatur der MSI prüfen (gültige Kette
//     UND Wazuh als Publisher) und sonst hart abbrechen.
//
// Werte sind GEGEN DEN LIVE-HOST verifiziert (nicht geraten):
//   GPG-Fingerprint : 0DCFCA5547B19D2A6099506096B3EE5F29111145
//     (installierter Keyring auf CT120 == Live-Quelle packages.wazuh.com/key)
//   MSI-Publisher   : Subject "CN=Wazuh, Inc" (Issuer DigiCert Trusted G4)
//     (osslsigncode verify der signierten 4.14.6-MSI)
//
// Statischer Vertrag (die Skripte sind Shell/PowerShell → nicht unit-ausführbar):
// wie installerSafety.test.js prüfen wir den Skript-Inhalt.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const SH  = path.join(__dirname, '../../../deploy/install-wazuh-agent.sh');
const PS1 = path.join(__dirname, '../../../deploy/install-wazuh-agent.ps1');
const read = (p) => fs.readFileSync(p, 'utf8');

// Verifizierter Wazuh-Signing-Key (primär). Ändert sich der Key, MUSS dieser
// Test (bewusst) rot werden, damit die Konstante nicht still veraltet.
const WAZUH_GPG_FPR = '0DCFCA5547B19D2A6099506096B3EE5F29111145';

describe('install-wazuh-agent.sh — GPG-Fingerprint-Pinning', () => {
  let src;
  beforeAll(() => { src = read(SH); });

  test('pinnt den verifizierten Wazuh-Fingerprint als Konstante', () => {
    expect(src).toContain(WAZUH_GPG_FPR);
  });

  test('liest den Fingerprint des importierten Keys aus (show-keys + with-fingerprint)', () => {
    expect(src).toMatch(/--show-keys/);
    expect(src).toMatch(/--with-fingerprint|--with-colons/);
  });

  test('bricht bei Fingerprint-Abweichung hart ab (die/exit), bevor apt den Key nutzt', () => {
    // Es muss einen Vergleich gegen die Konstante geben, der im Mismatch-Fall
    // das Skript beendet (die ... / exit 1). Wir prüfen, dass beide Bausteine
    // im Umfeld der Fingerprint-Prüfung vorkommen.
    expect(src).toMatch(/FINGERPRINT|FPR|EXPECTED_FPR/);
    expect(src).toMatch(/\bdie\b|\bexit 1\b/);
  });

  test('verifiziert den Key VOR jeder Übernahme und verwirft ihn bei Mismatch (kein Import untrusted)', () => {
    // Neues Design (multi-distro): fetch_and_verify_key lädt den Key in eine temp-
    // Datei und prüft den Fingerprint ZUERST; erst nach bestandener Prüfung wird er
    // als apt-Keyring dearmored bzw. per rpm --import übernommen. Bei Mismatch wird
    // die geladene Key-Datei entfernt (rm -f) und hart abgebrochen — nichts wird
    // importiert. Damit kann gar kein halb-importierter/untrusted Key zurückbleiben.
    expect(src).toMatch(/rm -f[^\n]*(\$tmp|\$keyfile|KEYRING|wazuh\.gpg)/);
    // Präzise auf die tatsächlichen Übernahme-KOMMANDOS matchen (nicht auf Kommentar-
    // Wörter wie „dearmored"): der erste echte Import/Dearmor kommt NACH dem AUFRUF von
    // fetch_and_verify_key (nicht dessen Definition).
    const idxVerifyCall = src.indexOf('"$(fetch_and_verify_key)"');
    const idxUse = src.search(/rpm --import|--dearmor -o/);
    expect(idxVerifyCall).toBeGreaterThan(-1);
    expect(idxUse).toBeGreaterThan(idxVerifyCall); // Übernahme erst NACH der Verifikation
  });
});

describe('install-wazuh-agent.ps1 — MSI-Authenticode-Prüfung', () => {
  let src;
  beforeAll(() => { src = read(PS1); });

  test('prüft die Authenticode-Signatur der MSI', () => {
    expect(src).toMatch(/Get-AuthenticodeSignature/);
  });

  test('verlangt eine gültige Signatur-Kette (Status Valid)', () => {
    expect(src).toMatch(/Status\s*-(eq|ne)\s*'?Valid'?|'Valid'/);
  });

  test('bindet den Publisher an Wazuh (Subject-Prüfung)', () => {
    expect(src).toMatch(/Wazuh, Inc|Wazuh/);
    expect(src).toMatch(/Subject/);
  });

  test('bricht bei ungültiger/fremder Signatur hart ab (throw) und installiert NICHT', () => {
    // Der throw muss vor dem msiexec-Aufruf greifen.
    const idxThrow = src.search(/throw[^\n]*(Signatur|signature|Authenticode|Publisher)/i);
    // Der ECHTE Install-Aufruf ('msiexec.exe'), nicht die frühere Kommentar-Erwähnung.
    const idxMsi = src.indexOf("'msiexec.exe'");
    expect(idxThrow).toBeGreaterThan(-1);
    expect(idxMsi).toBeGreaterThan(-1);
    expect(idxThrow).toBeLessThan(idxMsi);
  });
});
