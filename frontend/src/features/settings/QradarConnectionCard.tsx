import { Radar } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchQradarConnection, saveQradarConnection, testQradarConnection } from './settingsApi';
import {
  qradarFormFromMasked, buildQradarPatch, qradarConnError, qradarSourceLabel,
  type QradarMasked, type QradarForm, type QradarPatch,
} from './qradarConnectionModel';
import { useConnectionCard, ConnectionCardShell } from './connectionCardKit';

// QRadar-Verbindung (Layer 2): Base-URL + API-Token admin-seitig verwalten —
// Token verschlüsselt in der DB, ENV bleibt Fallback. Speichern mit Passwort-Step-up;
// Verbindungstest speichert nichts. Ablauf/Shell in connectionCardKit.

/** QRadar-Verbindungs-Karte (admin-only, Settings → Integrationen). */
export function QradarConnectionCard() {
  const c = useConnectionCard<QradarMasked, QradarForm, QradarPatch>({
    fetchConnection: fetchQradarConnection,
    saveConnection: saveQradarConnection,
    testConnection: (f) => testQradarConnection({ baseUrl: f.baseUrl.trim(), token: f.token }),
    formFromMasked: qradarFormFromMasked,
    buildPatch: buildQradarPatch,
    connError: qradarConnError,
    emptyForm: { baseUrl: '', token: '' },
    emptyPatch: { baseUrl: '', token: '' },
    loadErrorText: 'QRadar-Verbindung konnte nicht geladen werden.',
    successText: 'QRadar-Verbindung gespeichert — sofort aktiv, ohne Neustart. Die Änderung wurde protokolliert.',
    testErrorText: (status) => (status === 400 ? 'Ungültige URL (nur https).' : 'Test fehlgeschlagen.'),
    saveErrorText: (status) => (status === 400 ? 'Speichern abgelehnt: Eingabe ungültig (URL https, Token nötig).' : 'Speichern fehlgeschlagen.'),
  });

  return (
    <ConnectionCardShell
      title="QRadar-Verbindung"
      icon={<Radar size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>Base-URL und API-Token (SEC-Header) der QRadar-REST-API — verschlüsselt in der Datenbank,
        sofort wirksam. Falls noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag. Leeres Token-Feld = gespeichertes behalten.</>}
      sourceLabel={qradarSourceLabel}
      dialogTitle="QRadar-Verbindung bestätigen"
      dialogDescription="Zum Speichern der QRadar-Verbindung dein Passwort bestätigen. Der Token wird verschlüsselt gespeichert; die Änderung wird protokolliert und wirkt sofort."
      controller={c}
    >
      <Field label={<HelpLabel text="Base-URL (https)" topic="integrationen" hint={(
        <ExampleHint
          title="Adresse der QRadar-REST-API"
          text="Hier kommt die HTTPS-Basisadresse des QRadar-Systems hinein, gegen das Nexora spaeter Requests schickt."
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://qradar.intern' },
            { label: 'API-Pfad', value: '/api wird intern angehaengt' },
          ]}
          footer="Trage keine einzelne Ressource oder Query ein, sondern nur die Basisadresse des Systems."
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://qradar.intern" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <Field label={<HelpLabel text="API-Token (SEC)" topic="integrationen" hint={(
        <ExampleHint
          title="Technischer Zugriffstoken fuer QRadar"
          text="Das ist der SEC-Header-Token, mit dem Nexora sich an QRadar authentifiziert."
          exampleLabel="Praxis"
          rows={[
            { label: 'Quelle', value: 'QRadar API Token' },
            { label: 'Nutzung', value: 'eintragen, leer = behalten' },
          ]}
          footer="Den Token nur fuer Nexora vergeben und nicht denselben Wert fuer andere Tools wiederverwenden."
        />
      )} />}>
        <Input
          type="password"
          value={c.form.token}
          autoComplete="new-password"
          placeholder={c.masked?.tokenSet ? '••••••••  (gesetzt — leer = behalten)' : 'API-Token'}
          onChange={(e) => c.setForm((p) => ({ ...p, token: e.target.value }))}
        />
      </Field>
    </ConnectionCardShell>
  );
}
