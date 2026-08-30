import { Mail } from 'lucide-react';
import { Field, Input, Select, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchImapConnection, saveImapConnection, testImapConnection } from './settingsApi';
import {
  imapFormFromMasked, buildImapPatch, imapConnError, imapSourceLabel,
  type ImapMasked, type ImapForm, type ImapPatch,
} from './imapConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';
import { useTranslation } from 'react-i18next';

// IMAP-Postfach-Verbindung (Layer 2): Host/Port/User/Passwort/TLS admin-seitig
// verwalten — Passwort verschlüsselt in DB, ENV-Fallback. Der Poller übernimmt eine
// Änderung beim nächsten Zyklus (kein Neustart). Step-up beim Speichern.
// Gemeinsamer Ablauf/Shell liegt in connectionCardKit; hier nur Felder + Verdrahtung.

/** IMAP-Postfach-Verbindungs-Karte (admin-only, Settings → Integrationen). */
export function ImapConnectionCard() {
  const { t: tr } = useTranslation();
  const c = useConnectionCard<ImapMasked, ImapForm, ImapPatch>({
    fetchConnection: fetchImapConnection,
    saveConnection: saveImapConnection,
    testConnection: (f) => testImapConnection({ host: f.host.trim(), port: Number(f.port) || 993, user: f.user.trim(), imapPassword: f.imapPassword, secure: f.secure }),
    formFromMasked: imapFormFromMasked,
    buildPatch: buildImapPatch,
    connError: imapConnError,
    emptyForm: { host: '', port: '993', user: '', imapPassword: '', secure: true },
    emptyPatch: { host: '', port: 993, user: '', imapPassword: '', secure: true },
    loadErrorText: tr('settings.imapConnectionCouldNotLoaded'),
    successText: tr('settings.imapConnectionSavedPollerPicks'),
    testErrorText: (status) => (status === 400 ? tr('settings.invalidHostMetadataLinkLocal') : tr('settings.testFailedDot')),
    saveErrorText: (status) => (status === 400 ? tr('settings.saveRejectedInputIncompleteHost') : tr('common.savingFailed')),
  });

  return (
    <ConnectionCardShell
      title="IMAP-Postfach (E-Mail-Abruf)"
      icon={<Mail size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>{tr('settings.imapIntro')}</>}
      sourceLabel={imapSourceLabel}
      dialogTitle={tr('settings.confirmImapConnection')}
      dialogDescription={tr('settings.confirmYourPasswordSaveImap')}
      controller={c}
    >
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Host" topic="integrationen" hint={(
          <ExampleHint
            title={tr('text.imapServerMailboxPoll')}
            text={tr('settings.hostnameIpMailServerHosts')}
            exampleLabel="Beispiel"
            rows={[
              { label: 'Host', value: 'mail.nexora.local' },
              { label: 'Alternative', value: '10.0.10.85' },
            ]}
            footer={tr('settings.enterActualImapServerNot')}
          />
        )} />}>
          <Input value={c.form.host} placeholder="10.0.10.85" onChange={(e) => c.setForm((p) => ({ ...p, host: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="Port" topic="integrationen" hint={(
          <ExampleHint
            title={tr('settings.portWhichMailServerOffers')}
            text={tr('settings.port993CommonStandardImplicit')}
            exampleLabel="Typische Ports"
            rows={[
              { label: 'TLS', value: '993' },
              { label: 'STARTTLS', value: '143' },
            ]}
            footer={tr('settings.portEncryptionModeMustMatch')}
          />
        )} />}>
          <Input value={c.form.port} inputMode="numeric" placeholder="993" onChange={(e) => c.setForm((p) => ({ ...p, port: e.target.value }))} />
        </Field>
      </div>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text={tr('common.users')} topic="integrationen" hint={(
          <ExampleHint
            title={tr('text.whichMailboxNexoraShouldPoll')}
            text={tr('settings.usuallyFullMailAddressTechnical')}
            exampleLabel="Beispiel"
            rows={[
              { label: 'Mailbox', value: 'soc@nexora.local' },
            ]}
            footer={tr('text.dedicatedSharedMailboxWorksBetter')}
          />
        )} />}>
          <Input value={c.form.user} autoComplete="off" placeholder="soc@nexora.local" onChange={(e) => c.setForm((p) => ({ ...p, user: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text={tr('common.password')} topic="integrationen" hint={(
          <ExampleHint
            title={tr('settings.secretImapMailbox')}
            text={tr('settings.passwordOnlyNeededWhenSetting')}
            exampleLabel="Praxis"
            rows={[
              { label: tr('common.reset'), value: tr('settings.enterSave') },
              { label: 'Behalten', value: tr('settings.leaveFieldEmpty') },
            ]}
            footer={tr('settings.ifMailSystemUsesApp')}
          />
        )} />}>
          <Input
            type="password"
            value={c.form.imapPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt — leer = behalten)' : tr('settings.mailboxPassword')}
            onChange={(e) => c.setForm((p) => ({ ...p, imapPassword: e.target.value }))}
          />
        </Field>
      </div>
      <Field label={<HelpLabel text={tr('settings.encryption')} topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.howImapChannelProtected')}
          text={tr('settings.chooseOptionMatchesYourServer')}
          exampleLabel="Merksatz"
          rows={[
            { label: '993', value: 'Implizites TLS' },
            { label: '143', value: 'STARTTLS / Klartext plus Upgrade' },
          ]}
          footer={tr('settings.wrongCombinationUsernamePasswordOften')}
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
