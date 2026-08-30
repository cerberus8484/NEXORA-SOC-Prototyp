import { Waves } from 'lucide-react';
import { Field, Input, Select, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchCrowdsecConnection, saveCrowdsecConnection, testCrowdsecConnection } from './settingsApi';
import {
  crowdsecFormFromMasked, buildCrowdsecPatch, crowdsecConnError, crowdsecSourceLabel,
  type CrowdsecMasked, type CrowdsecForm, type CrowdsecPatch,
} from './crowdsecConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';
import { useTranslation } from 'react-i18next';

export function CrowdsecConnectionCard() {
  const { t: tr } = useTranslation();
  const c = useConnectionCard<CrowdsecMasked, CrowdsecForm, CrowdsecPatch>({
    fetchConnection: fetchCrowdsecConnection,
    saveConnection: saveCrowdsecConnection,
    testConnection: (f) => testCrowdsecConnection({ baseUrl: f.baseUrl.trim(), machineId: f.machineId.trim(), lapiPassword: f.lapiPassword, tlsInsecure: f.tlsInsecure }),
    formFromMasked: crowdsecFormFromMasked,
    buildPatch: buildCrowdsecPatch,
    connError: crowdsecConnError,
    emptyForm: { baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false },
    emptyPatch: { baseUrl: '', machineId: '', lapiPassword: '', tlsInsecure: false },
    loadErrorText: tr('settings.crowdsecConnectionCouldNotLoaded'),
    successText: tr('settings.crowdsecConnectionSavedPollerPicks'),
    testErrorText: (status) => (status === 400 ? 'Ungueltige URL (Loopback/Metadaten gesperrt).' : tr('settings.testFailedDot')),
    saveErrorText: (status) => (status === 400 ? tr('settings.saveRejectedInputIncompleteUrl2') : tr('common.savingFailed')),
  });

  return (
    <ConnectionCardShell
      title={tr('settings.crowdsecConnectionTitle')}
      icon={<Waves size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>{tr('settings.crowdsecIntro')}</>}
      sourceLabel={crowdsecSourceLabel}
      dialogTitle={tr('settings.confirmCrowdsec')}
      dialogDescription={tr('settings.confirmYourPasswordSaveCrowdsec')}
      controller={c}
    >
      <Field label={<HelpLabel text="LAPI-URL" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.addressCrowdsecLocalApi')}
          text={tr('settings.actualLapiAddressNexoraWill')}
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://10.0.10.91:8080' },
            { label: tr('text.note'), value: tr('settings.internalService') },
          ]}
          footer={tr('settings.lapiUrlNotCrowdsecConsole')}
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://10.0.10.91:8080" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Machine-ID" topic="integrationen" hint={(
          <ExampleHint
            title={tr('text.identifierAuthorisedCrowdsecClient')}
            text={tr('settings.machineIdIdentifiesNexoraLapi')}
            exampleLabel="Beispiel"
            rows={[
              { label: 'Machine-ID', value: 'nexora' },
            ]}
            footer={tr('settings.useExactlyIdentifierMatchingPassword')}
          />
        )} />}>
          <Input value={c.form.machineId} autoComplete="off" placeholder="nexora" onChange={(e) => c.setForm((p) => ({ ...p, machineId: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text={tr('common.password')} topic="integrationen" hint={(
          <ExampleHint
            title={tr('settings.secretSelectedMachineId')}
            text={tr('settings.passwordBelongsMachineIdLeft')}
            exampleLabel="Praxis"
            rows={[
              { label: tr('common.reset'), value: tr('settings.enterSave') },
              { label: 'Behalten', value: 'leer lassen' },
            ]}
            footer={tr('settings.idPasswordMustComeFrom')}
          />
        )} />}>
          <Input
            type="password"
            value={c.form.lapiPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt - leer = behalten)' : tr('settings.machinePassword')}
            onChange={(e) => c.setForm((p) => ({ ...p, lapiPassword: e.target.value }))}
          />
        </Field>
      </div>
      <Field label={<HelpLabel text="TLS" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.howStrictlyCertificateVerified')}
          text={tr('settings.normallyNexoraShouldVerifyCertificate')}
          exampleLabel="Sicherer Standard"
          rows={[
            { label: tr('common.recommended'), value: tr('settings.verifyCertificate') },
            { label: tr('text.internalOnly'), value: tr('settings.acceptSelfSigned') },
          ]}
          footer={tr('text.onlyUseInsecureOptionIf')}
        />
      )} />}>
        <Select
          value={c.form.tlsInsecure ? 'insecure' : 'verify'}
          onChange={(e) => c.setForm((p) => ({ ...p, tlsInsecure: e.target.value === 'insecure' }))}
          options={[{ value: 'verify', label: tr('settings.verifyCertificate') }, { value: 'insecure', label: tr('text.acceptSelfSignedInternalOnly') }]}
        />
      </Field>
    </ConnectionCardShell>
  );
}
