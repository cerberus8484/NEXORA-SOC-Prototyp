import { Send } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchServicenowConnection, saveServicenowConnection, testServicenowConnection } from './settingsApi';
import {
  servicenowFormFromMasked, buildServicenowPatch, servicenowConnError, servicenowSourceLabel,
  type ServicenowMasked, type ServicenowForm, type ServicenowPatch,
} from './servicenowConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';
import { useTranslation } from 'react-i18next';

export function ServicenowConnectionCard() {
  const { t: tr } = useTranslation();
  const c = useConnectionCard<ServicenowMasked, ServicenowForm, ServicenowPatch>({
    fetchConnection: fetchServicenowConnection,
    saveConnection: saveServicenowConnection,
    testConnection: (f) => testServicenowConnection({ baseUrl: f.baseUrl.trim(), username: f.username.trim(), servicenowPassword: f.servicenowPassword, table: f.table.trim() }),
    formFromMasked: servicenowFormFromMasked,
    buildPatch: buildServicenowPatch,
    connError: servicenowConnError,
    emptyForm: { baseUrl: '', username: '', servicenowPassword: '', table: '' },
    emptyPatch: { baseUrl: '', username: '', servicenowPassword: '', table: '' },
    loadErrorText: tr('settings.servicenowConnectionCouldNotLoaded'),
    successText: tr('settings.servicenowConnectionSavedExportAdapter'),
    testErrorText: (status) => (status === 400 ? tr('text.invalidUrlHttpsOnlyLoopback') : tr('settings.testFailedDot')),
    saveErrorText: (status) => (status === 400 ? tr('settings.saveRejectedInputIncompleteUrl') : tr('common.savingFailed')),
  });

  return (
    <ConnectionCardShell
      title={tr('settings.servicenowConnectionTitle')}
      icon={<Send size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>{tr('settings.servicenowIntro')}</>}
      sourceLabel={servicenowSourceLabel}
      dialogTitle={tr('settings.confirmServicenow')}
      dialogDescription={tr('settings.confirmYourPasswordSaveServicenow')}
      controller={c}
    >
      <Field label={<HelpLabel text="Instance-URL" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.baseAddressServicenowInstance')}
          text={tr('settings.enterActualInstanceAddressNexora')}
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://acme.service-now.com' },
          ]}
          footer={tr('settings.doNotEnterSingleApi')}
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://acme.service-now.com" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text={tr('common.users')} topic="integrationen" hint={(
          <ExampleHint
            title="Technischer ServiceNow-Exportbenutzer"
            text={tr('settings.accountShouldReservedNexoraHold')}
            exampleLabel="Beispiel"
            rows={[
              { label: 'User', value: 'soc.integration' },
            ]}
            footer={tr('text.doNotUsePersonalUser')}
          />
        )} />}>
          <Input value={c.form.username} autoComplete="off" placeholder="soc.integration" onChange={(e) => c.setForm((p) => ({ ...p, username: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text={tr('common.password')} topic="integrationen" hint={(
          <ExampleHint
            title={tr('text.secretIntegrationAccount')}
            text={tr('settings.passwordOnlyNeededWhenSetting2')}
            exampleLabel="Praxis"
            rows={[
              { label: tr('common.reset'), value: tr('settings.enterSave') },
              { label: 'Behalten', value: 'leer lassen' },
            ]}
            footer={tr('text.interfaceNeverDisplaysStoredSecrets')}
          />
        )} />}>
          <Input
            type="password"
            value={c.form.servicenowPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt - leer = behalten)' : tr('settings.servicenowPassword')}
            onChange={(e) => c.setForm((p) => ({ ...p, servicenowPassword: e.target.value }))}
          />
        </Field>
      </div>
      <Field label={<HelpLabel text="Table" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.whichServicenowTableExported')}
          text={tr('settings.definesTargetObjectOutboundExport')}
          exampleLabel={tr('common.typicalValue')}
          rows={[
            { label: 'Table', value: 'incident' },
          ]}
          footer={tr('settings.onlyEnterTableIntegrationAccount')}
        />
      )} />}>
        <Input value={c.form.table} autoComplete="off" placeholder="incident" onChange={(e) => c.setForm((p) => ({ ...p, table: e.target.value }))} />
      </Field>
    </ConnectionCardShell>
  );
}
