import { Mail } from 'lucide-react';
import { Field, Input, Select, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchImapConnection, saveImapConnection, testImapConnection } from './settingsApi';
import {
  imapFormFromMasked, buildImapPatch, imapConnError, imapSourceLabel,
  type ImapMasked, type ImapForm, type ImapPatch,
} from './imapConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';

// IMAP-Postfach-Verbindung (Layer 2): Host/Port/User/Passwort/TLS admin-seitig
// verwalten — Passwort verschlüsselt in DB, ENV-Fallback. Der Poller übernimmt eine
// Änderung beim nächsten Zyklus (kein Neustart). Step-up beim Speichern.
// Gemeinsamer Ablauf/Shell liegt in connectionCardKit; hier nur Felder + Verdrahtung.

/** IMAP-Postfach-Verbindungs-Karte (admin-only, Settings → Integrationen). */
export function ImapConnectionCard() {
  const c = useConnectionCard<ImapMasked, ImapForm, ImapPatch>({
    fetchConnection: fetchImapConnection,
    saveConnection: saveImapConnection,
    testConnection: (f) => testImapConnection({ host: f.host.trim(), port: Number(f.port) || 993, user: f.user.trim(), imapPassword: f.imapPassword, secure: f.secure }),
    formFromMasked: imapFormFromMasked,
    buildPatch: buildImapPatch,
    connError: imapConnError,
    emptyForm: { host: '', port: '993', user: '', imapPassword: '', secure: true },
    emptyPatch: { host: '', port: 993, user: '', imapPassword: '', secure: true },
    loadErrorText: 'IMAP-Verbindung konnte nicht geladen werden.',
    successText: 'IMAP-Verbindung gespeichert — der Poller übernimmt sie beim nächsten Zyklus (ohne Neustart). Protokolliert.',
    testErrorText: (status) => (status === 400 ? 'Ungültiger Host (Metadaten/Link-local gesperrt).' : 'Test fehlgeschlagen.'),
    saveErrorText: (status) => (status === 400 ? 'Speichern abgelehnt: Eingabe unvollständig oder Host gesperrt.' : 'Speichern fehlgeschlagen.'),
  });

  return (
    <ConnectionCardShell
      title="IMAP-Postfach (E-Mail-Abruf)"
      icon={<Mail size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>Host, Port, Benutzer und Passwort des IMAP-Postfachs (z.B. das SOC-Phishing-Postfach) — Passwort
        verschlüsselt in der Datenbank. Der Poller holt ungelesene Mails periodisch in die Ticket-Pipeline;
        eine Änderung greift beim nächsten Zyklus, ohne Neustart. Falls noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag.
        Leeres Passwort = behalten.</>}
      sourceLabel={imapSourceLabel}
      dialogTitle="IMAP-Verbindung bestätigen"
      dialogDescription="Zum Speichern der IMAP-Verbindung dein Passwort bestätigen. Das Postfach-Passwort wird verschlüsselt gespeichert; die Änderung wird protokolliert und greift beim nächsten Poll-Zyklus."
      controller={c}
    >
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Host" topic="integrationen" hint={(
          <ExampleHint
            title="IMAP-Server des abzurufenden Postfachs"
            text="Der Hostname oder die IP des Mailservers, auf dem das SOC-Postfach liegt."
            exampleLabel="Beispiel"
            rows={[
              { label: 'Host', value: 'mail.nexora.local' },
              { label: 'Alternative', value: '10.0.10.85' },
            ]}
            footer="Nicht die Webmail-URL eintragen, sondern den echten IMAP-Server."
          />
        )} />}>
          <Input value={c.form.host} placeholder="10.0.10.85" onChange={(e) => c.setForm((p) => ({ ...p, host: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="Port" topic="integrationen" hint={(
          <ExampleHint
            title="Auf welchem Port der Mailserver IMAP anbietet"
            text="Port 993 ist der gaengige Standard fuer implizites TLS, 143 eher fuer STARTTLS."
            exampleLabel="Typische Ports"
            rows={[
              { label: 'TLS', value: '993' },
              { label: 'STARTTLS', value: '143' },
            ]}
            footer="Port und Verschluesselungsart muessen zusammenpassen, sonst scheitert der Poller spaeter trotz korrekter Zugangsdaten."
          />
        )} />}>
          <Input value={c.form.port} inputMode="numeric" placeholder="993" onChange={(e) => c.setForm((p) => ({ ...p, port: e.target.value }))} />
        </Field>
      </div>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Benutzer" topic="integrationen" hint={(
          <ExampleHint
            title="Welches Postfach Nexora abrufen soll"
            text="Das ist in der Regel die volle Mailadresse oder der technische Login des SOC-Postfachs."
            exampleLabel="Beispiel"
            rows={[
              { label: 'Mailbox', value: 'soc@nexora.local' },
            ]}
            footer="Am besten ein dediziertes Sammelpostfach statt persoenlicher Benutzerkonten."
          />
        )} />}>
          <Input value={c.form.user} autoComplete="off" placeholder="soc@nexora.local" onChange={(e) => c.setForm((p) => ({ ...p, user: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="Passwort" topic="integrationen" hint={(
          <ExampleHint
            title="Secret fuer das IMAP-Postfach"
            text="Dieses Passwort wird nur zum Setzen oder Rotieren gebraucht. Leer bedeutet: vorhandenes Secret behalten."
            exampleLabel="Praxis"
            rows={[
              { label: 'Neu setzen', value: 'eintragen und speichern' },
              { label: 'Behalten', value: 'Feld leer lassen' },
            ]}
            footer="Wenn das Mailsystem App-Passwoerter nutzt, gehoert genau dieses hier hinein."
          />
        )} />}>
          <Input
            type="password"
            value={c.form.imapPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt — leer = behalten)' : 'Postfach-Passwort'}
            onChange={(e) => c.setForm((p) => ({ ...p, imapPassword: e.target.value }))}
          />
        </Field>
      </div>
      <Field label={<HelpLabel text="Verschluesselung" topic="integrationen" hint={(
        <ExampleHint
          title="Wie der IMAP-Kanal geschuetzt wird"
          text="Waehle die Variante, die zum Server und zum Port passt."
          exampleLabel="Merksatz"
          rows={[
            { label: '993', value: 'Implizites TLS' },
            { label: '143', value: 'STARTTLS / Klartext plus Upgrade' },
          ]}
          footer="Bei falscher Kombination wirken Benutzername und Passwort oft falsch, obwohl eigentlich nur die Transportart nicht passt."
        />
      )} />}>
        <Select
          value={c.form.secure ? 'tls' : 'starttls'}
          onChange={(e) => c.setForm((p) => ({ ...p, secure: e.target.value === 'tls' }))}
          options={[{ value: 'tls', label: 'Implizites TLS (Port 993)' }, { value: 'starttls', label: 'STARTTLS / Klartext (z.B. Port 143)' }]}
        />
      </Field>
    </ConnectionCardShell>
  );
}
