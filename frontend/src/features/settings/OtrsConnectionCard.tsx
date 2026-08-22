import { Ticket } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchOtrsConnection, saveOtrsConnection, testOtrsConnection } from './settingsApi';
import {
  otrsFormFromMasked, buildOtrsPatch, otrsConnError, otrsSourceLabel,
  type OtrsMasked, type OtrsForm, type OtrsPatch,
} from './otrsConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';

export function OtrsConnectionCard() {
  const c = useConnectionCard<OtrsMasked, OtrsForm, OtrsPatch>({
    fetchConnection: fetchOtrsConnection,
    saveConnection: saveOtrsConnection,
    testConnection: (f) => testOtrsConnection({ baseUrl: f.baseUrl.trim(), username: f.username.trim(), otrsPassword: f.otrsPassword, webService: f.webService.trim() }),
    formFromMasked: otrsFormFromMasked,
    buildPatch: buildOtrsPatch,
    connError: otrsConnError,
    emptyForm: { baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '' },
    emptyPatch: { baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '' },
    loadErrorText: 'OTRS-Verbindung konnte nicht geladen werden.',
    successText: 'OTRS-Verbindung gespeichert - der Export-Adapter uebernimmt sie sofort (ohne Neustart). Protokolliert.',
    testErrorText: (status) => (status === 400 ? 'Ungueltige URL (http/https; Loopback/Metadaten gesperrt).' : 'Test fehlgeschlagen.'),
    saveErrorText: (status) => (status === 400 ? 'Speichern abgelehnt: Eingabe unvollstaendig oder URL nicht erlaubt.' : 'Speichern fehlgeschlagen.'),
  });

  return (
    <ConnectionCardShell
      title="OTRS / Znuny-Verbindung (Outbound-Export)"
      icon={<Ticket size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>Base-URL, Agent-Benutzer und Passwort des OTRS/Znuny-GenericInterface fuer den
        Ticket-Export - Passwort verschluesselt in der Datenbank. Eine Aenderung greift sofort,
        ohne Neustart. Falls noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag. Leeres Passwort = behalten.</>}
      sourceLabel={otrsSourceLabel}
      dialogTitle="OTRS-Verbindung bestaetigen"
      dialogDescription="Zum Speichern der OTRS-Verbindung dein Passwort bestaetigen. Das OTRS-Passwort wird verschluesselt gespeichert; die Aenderung wird protokolliert und wirkt sofort."
      controller={c}
    >
      <Field label={<HelpLabel text="Base-URL" topic="integrationen" hint={(
        <ExampleHint
          title="Adresse des OTRS- oder Znuny-Systems"
          text="Das ist die Basisadresse des Zielsystems, gegen das Nexora spaeter exportiert."
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://otrs.firma.local' },
          ]}
          footer="Nicht den GenericInterface-Unterpfad eintragen, sondern die Basisadresse des Systems."
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://otrs.firma.local" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Agent-Benutzer" topic="integrationen" hint={(
          <ExampleHint
            title="Technisches Agent-Konto fuer den Export"
            text="Dieser Benutzer fuehrt die spaeteren Ticket-Operationen in OTRS oder Znuny aus."
            exampleLabel="Beispiel"
            rows={[
              { label: 'User', value: 'soc-agent' },
            ]}
            footer="Am besten ein dediziertes Integrationskonto statt eines persoenlichen Agent-Users."
          />
        )} />}>
          <Input value={c.form.username} autoComplete="off" placeholder="soc-agent" onChange={(e) => c.setForm((p) => ({ ...p, username: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="Passwort" topic="integrationen" hint={(
          <ExampleHint
            title="Secret des Agent-Kontos"
            text="Dieses Passwort brauchst du nur zum Setzen oder Rotieren. Leer laesst das aktuelle Secret unveraendert."
            exampleLabel="Praxis"
            rows={[
              { label: 'Neu setzen', value: 'eintragen und speichern' },
              { label: 'Behalten', value: 'leer lassen' },
            ]}
            footer="Das gespeicherte Passwort wird von Nexora nie wieder im Klartext angezeigt."
          />
        )} />}>
          <Input
            type="password"
            value={c.form.otrsPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt - leer = behalten)' : 'OTRS-Passwort'}
            onChange={(e) => c.setForm((p) => ({ ...p, otrsPassword: e.target.value }))}
          />
        </Field>
      </div>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Queue" topic="integrationen" hint={(
          <ExampleHint
            title="In welche Warteschlange neue Tickets sollen"
            text="Die Queue bestimmt, wo die exportierten Faelle im Zielsystem landen."
            exampleLabel="Beispiel"
            rows={[
              { label: 'Queue', value: 'Security' },
            ]}
            footer="Nur eine Queue eintragen, auf die das Integrationskonto auch wirklich Zugriff hat."
          />
        )} />}>
          <Input value={c.form.queue} autoComplete="off" placeholder="Security" onChange={(e) => c.setForm((p) => ({ ...p, queue: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="WebService" topic="integrationen" hint={(
          <ExampleHint
            title="Name des freigeschalteten GenericInterface-Webservice"
            text="Hier kommt der exakte Webservice-Name aus OTRS oder Znuny hinein."
            exampleLabel="Beispiel"
            rows={[
              { label: 'WebService', value: 'GenericTicketConnectorREST' },
            ]}
            footer="Der Name muss exakt stimmen, sonst findet Nexora die Zieloperation spaeter nicht."
          />
        )} />}>
          <Input value={c.form.webService} autoComplete="off" placeholder="GenericTicketConnectorREST" onChange={(e) => c.setForm((p) => ({ ...p, webService: e.target.value }))} />
        </Field>
      </div>
      <Field label={<HelpLabel text="Operation" topic="integrationen" hint={(
        <ExampleHint
          title="Welche Aktion im Webservice aufgerufen wird"
          text="Die Operation bezeichnet den konkreten Endpunkt oder Funktionsnamen innerhalb des Webservice."
          exampleLabel="Beispiel"
          rows={[
            { label: 'Operation', value: 'TicketCreate' },
          ]}
          footer="Die Operation muss zum gewaehlten Webservice passen, sonst ist der Export zwar verbunden, aber funktional falsch verdrahtet."
        />
      )} />}>
        <Input value={c.form.operation} autoComplete="off" placeholder="TicketCreate" onChange={(e) => c.setForm((p) => ({ ...p, operation: e.target.value }))} />
      </Field>
    </ConnectionCardShell>
  );
}
