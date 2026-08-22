import { Send } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchServicenowConnection, saveServicenowConnection, testServicenowConnection } from './settingsApi';
import {
  servicenowFormFromMasked, buildServicenowPatch, servicenowConnError, servicenowSourceLabel,
  type ServicenowMasked, type ServicenowForm, type ServicenowPatch,
} from './servicenowConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';

export function ServicenowConnectionCard() {
  const c = useConnectionCard<ServicenowMasked, ServicenowForm, ServicenowPatch>({
    fetchConnection: fetchServicenowConnection,
    saveConnection: saveServicenowConnection,
    testConnection: (f) => testServicenowConnection({ baseUrl: f.baseUrl.trim(), username: f.username.trim(), servicenowPassword: f.servicenowPassword, table: f.table.trim() }),
    formFromMasked: servicenowFormFromMasked,
    buildPatch: buildServicenowPatch,
    connError: servicenowConnError,
    emptyForm: { baseUrl: '', username: '', servicenowPassword: '', table: '' },
    emptyPatch: { baseUrl: '', username: '', servicenowPassword: '', table: '' },
    loadErrorText: 'ServiceNow-Verbindung konnte nicht geladen werden.',
    successText: 'ServiceNow-Verbindung gespeichert - der Export-Adapter uebernimmt sie sofort (ohne Neustart). Protokolliert.',
    testErrorText: (status) => (status === 400 ? 'Ungueltige URL (nur https; Loopback/Metadaten gesperrt).' : 'Test fehlgeschlagen.'),
    saveErrorText: (status) => (status === 400 ? 'Speichern abgelehnt: Eingabe unvollstaendig oder URL nicht erlaubt.' : 'Speichern fehlgeschlagen.'),
  });

  return (
    <ConnectionCardShell
      title="ServiceNow-Verbindung (Outbound-Export)"
      icon={<Send size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>Instance-URL, Benutzer und Passwort des ServiceNow-Kontos fuer den Ticket-Export -
        Passwort verschluesselt in der Datenbank. Eine Aenderung greift sofort, ohne Neustart. Falls aus
        noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag. Leeres Passwort = behalten.</>}
      sourceLabel={servicenowSourceLabel}
      dialogTitle="ServiceNow-Verbindung bestaetigen"
      dialogDescription="Zum Speichern der ServiceNow-Verbindung dein Passwort bestaetigen. Das ServiceNow-Passwort wird verschluesselt gespeichert; die Aenderung wird protokolliert und wirkt sofort."
      controller={c}
    >
      <Field label={<HelpLabel text="Instance-URL" topic="integrationen" hint={(
        <ExampleHint
          title="Basisadresse der ServiceNow-Instanz"
          text="Hier kommt die eigentliche Instanzadresse hinein, gegen die Nexora spaeter exportiert."
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://acme.service-now.com' },
          ]}
          footer="Keine einzelne API-Route eintragen, sondern nur die Hauptadresse der Instanz."
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://acme.service-now.com" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Benutzer" topic="integrationen" hint={(
          <ExampleHint
            title="Technischer ServiceNow-Exportbenutzer"
            text="Dieses Konto sollte fuer Nexora reserviert sein und nur die noetigen Rechte fuer den Export besitzen."
            exampleLabel="Beispiel"
            rows={[
              { label: 'User', value: 'soc.integration' },
            ]}
            footer="Kein persoenliches Benutzerkonto verwenden, sondern ein dediziertes Integrationskonto."
          />
        )} />}>
          <Input value={c.form.username} autoComplete="off" placeholder="soc.integration" onChange={(e) => c.setForm((p) => ({ ...p, username: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="Passwort" topic="integrationen" hint={(
          <ExampleHint
            title="Secret des Integrationskontos"
            text="Das Passwort wird nur zum Setzen oder Rotieren gebraucht. Leer bedeutet: aktuelles Secret beibehalten."
            exampleLabel="Praxis"
            rows={[
              { label: 'Neu setzen', value: 'eintragen und speichern' },
              { label: 'Behalten', value: 'leer lassen' },
            ]}
            footer="Die UI zeigt gespeicherte Secrets nie wieder an."
          />
        )} />}>
          <Input
            type="password"
            value={c.form.servicenowPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt - leer = behalten)' : 'ServiceNow-Passwort'}
            onChange={(e) => c.setForm((p) => ({ ...p, servicenowPassword: e.target.value }))}
          />
        </Field>
      </div>
      <Field label={<HelpLabel text="Table" topic="integrationen" hint={(
        <ExampleHint
          title="In welche ServiceNow-Tabelle exportiert wird"
          text="Hier definierst du das Zielobjekt fuer den Outbound-Export."
          exampleLabel="Typischer Wert"
          rows={[
            { label: 'Table', value: 'incident' },
          ]}
          footer="Nur eine Tabelle eintragen, fuer die das Integrationskonto auch wirklich Schreibrechte besitzt."
        />
      )} />}>
        <Input value={c.form.table} autoComplete="off" placeholder="incident" onChange={(e) => c.setForm((p) => ({ ...p, table: e.target.value }))} />
      </Field>
    </ConnectionCardShell>
  );
}
