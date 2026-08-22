import { Waves } from 'lucide-react';
import { Field, Input, Select, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchCrowdsecConnection, saveCrowdsecConnection, testCrowdsecConnection } from './settingsApi';
import {
  crowdsecFormFromMasked, buildCrowdsecPatch, crowdsecConnError, crowdsecSourceLabel,
  type CrowdsecMasked, type CrowdsecForm, type CrowdsecPatch,
} from './crowdsecConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';

export function CrowdsecConnectionCard() {
  const c = useConnectionCard<CrowdsecMasked, CrowdsecForm, CrowdsecPatch>({
    fetchConnection: fetchCrowdsecConnection,
    saveConnection: saveCrowdsecConnection,
    testConnection: (f) => testCrowdsecConnection({ baseUrl: f.baseUrl.trim(), machineId: f.machineId.trim(), lapiPassword: f.lapiPassword, tlsInsecure: f.tlsInsecure }),
    formFromMasked: crowdsecFormFromMasked,
    buildPatch: buildCrowdsecPatch,
    connError: crowdsecConnError,
    emptyForm: { baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false },
    emptyPatch: { baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false },
    loadErrorText: 'CrowdSec-Verbindung konnte nicht geladen werden.',
    successText: 'CrowdSec-Verbindung gespeichert - der Poller uebernimmt sie beim naechsten Zyklus (ohne Neustart). Protokolliert.',
    testErrorText: (status) => (status === 400 ? 'Ungueltige URL (Loopback/Metadaten gesperrt).' : 'Test fehlgeschlagen.'),
    saveErrorText: (status) => (status === 400 ? 'Speichern abgelehnt: Eingabe unvollstaendig oder URL gesperrt.' : 'Speichern fehlgeschlagen.'),
  });

  return (
    <ConnectionCardShell
      title="CrowdSec-Verbindung (LAPI)"
      icon={<Waves size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>LAPI-URL, Machine-ID und Passwort des Webserver-CrowdSec - Passwort verschluesselt in der
        Datenbank. Der Poller zieht WAN-Alerts periodisch; eine Aenderung greift beim naechsten
        Zyklus, ohne Neustart. Falls noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag. Leeres Passwort = behalten.</>}
      sourceLabel={crowdsecSourceLabel}
      dialogTitle="CrowdSec-Verbindung bestaetigen"
      dialogDescription="Zum Speichern der CrowdSec-Verbindung dein Passwort bestaetigen. Das LAPI-Passwort wird verschluesselt gespeichert; die Aenderung wird protokolliert und greift beim naechsten Poll-Zyklus."
      controller={c}
    >
      <Field label={<HelpLabel text="LAPI-URL" topic="integrationen" hint={(
        <ExampleHint
          title="Adresse der CrowdSec Local API"
          text="Das ist die konkrete LAPI-Adresse, gegen die Nexora spaeter pollt."
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://10.0.10.91:8080' },
            { label: 'Hinweis', value: 'interner Dienst' },
          ]}
          footer="Die LAPI-URL ist nicht die CrowdSec-Console, sondern die technische API des Agents oder Gateways."
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://10.0.10.91:8080" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Machine-ID" topic="integrationen" hint={(
          <ExampleHint
            title="Kennung des berechtigten CrowdSec-Clients"
            text="Die Machine-ID identifiziert Nexora gegen die LAPI."
            exampleLabel="Beispiel"
            rows={[
              { label: 'Machine-ID', value: 'nexora' },
            ]}
            footer="Nimm exakt die Kennung, fuer die in CrowdSec auch das passende Passwort ausgestellt wurde."
          />
        )} />}>
          <Input value={c.form.machineId} autoComplete="off" placeholder="nexora" onChange={(e) => c.setForm((p) => ({ ...p, machineId: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="Passwort" topic="integrationen" hint={(
          <ExampleHint
            title="Secret zur gewaehlten Machine-ID"
            text="Dieses Passwort gehoert genau zu der Machine-ID links und wird nur beim Setzen oder Rotieren gebraucht."
            exampleLabel="Praxis"
            rows={[
              { label: 'Neu setzen', value: 'eintragen und speichern' },
              { label: 'Behalten', value: 'leer lassen' },
            ]}
            footer="ID und Passwort muessen aus demselben CrowdSec-Client-Paar stammen."
          />
        )} />}>
          <Input
            type="password"
            value={c.form.lapiPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt - leer = behalten)' : 'Machine-Passwort'}
            onChange={(e) => c.setForm((p) => ({ ...p, lapiPassword: e.target.value }))}
          />
        </Field>
      </div>
      <Field label={<HelpLabel text="TLS" topic="integrationen" hint={(
        <ExampleHint
          title="Wie streng das Zertifikat geprueft wird"
          text="Im Normalfall sollte Nexora das Zertifikat sauber verifizieren. Unsicher nur fuer interne Self-signed-Setups."
          exampleLabel="Sicherer Standard"
          rows={[
            { label: 'Empfohlen', value: 'Zertifikat pruefen' },
            { label: 'Nur intern', value: 'Self-signed akzeptieren' },
          ]}
          footer="Unsicher nur verwenden, wenn du wirklich ein internes Self-signed-Setup bewusst akzeptierst."
        />
      )} />}>
        <Select
          value={c.form.tlsInsecure ? 'insecure' : 'verify'}
          onChange={(e) => c.setForm((p) => ({ ...p, tlsInsecure: e.target.value === 'insecure' }))}
          options={[{ value: 'verify', label: 'Zertifikat pruefen' }, { value: 'insecure', label: 'Self-signed akzeptieren (nur intern)' }]}
        />
      </Field>
    </ConnectionCardShell>
  );
}
