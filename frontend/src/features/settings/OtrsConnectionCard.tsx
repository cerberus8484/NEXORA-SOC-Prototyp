import { Ticket } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchOtrsConnection, saveOtrsConnection, testOtrsConnection } from './settingsApi';
import {
  otrsFormFromMasked, buildOtrsPatch, otrsConnError, otrsSourceLabel,
  type OtrsMasked, type OtrsForm, type OtrsPatch,
} from './otrsConnectionModel';
import { useConnectionCard, ConnectionCardShell, cardStyles } from './connectionCardKit';
import { useTranslation } from 'react-i18next';

export function OtrsConnectionCard() {
  const { t: tr } = useTranslation();
  const c = useConnectionCard<OtrsMasked, OtrsForm, OtrsPatch>({
    fetchConnection: fetchOtrsConnection,
    saveConnection: saveOtrsConnection,
    testConnection: (f) => testOtrsConnection({ baseUrl: f.baseUrl.trim(), username: f.username.trim(), otrsPassword: f.otrsPassword, webService: f.webService.trim() }),
    formFromMasked: otrsFormFromMasked,
    buildPatch: buildOtrsPatch,
    connError: otrsConnError,
    emptyForm: { baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '' },
    emptyPatch: { baseUrl: '', username: '', otrsPassword: '', queue: '', webService: '', operation: '' },
    loadErrorText: tr('settings.otrsConnectionCouldNotLoaded'),
    successText: tr('settings.otrsConnectionSavedExportAdapter'),
    testErrorText: (status) => (status === 400 ? 'Ungueltige URL (http/https; Loopback/Metadaten gesperrt).' : tr('settings.testFailedDot')),
    saveErrorText: (status) => (status === 400 ? tr('settings.saveRejectedInputIncompleteUrl') : tr('common.savingFailed')),
  });

  return (
    <ConnectionCardShell
      title={tr('settings.otrsConnectionTitle')}
      icon={<Ticket size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>{tr('settings.otrsIntro')}</>}
      sourceLabel={otrsSourceLabel}
      dialogTitle={tr('settings.confirmOtrs')}
      dialogDescription={tr('settings.confirmYourPasswordSaveOtrs')}
      controller={c}
    >
      <Field label={<HelpLabel text="Base-URL" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.addressOtrsZnunySystem')}
          text={tr('settings.baseAddressTargetSystemNexora')}
          exampleLabel={tr('common.example')}
          rows={[
            { label: 'URL', value: 'https://otrs.firma.local' },
          ]}
          footer={tr('settings.enterSystemSBaseAddress')}
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://otrs.firma.local" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text={tr('settings.agentUser')} topic="integrationen" hint={(
          <ExampleHint
            title={tr('settings.technicalAgentAccountExport')}
            text={tr('settings.userPerformsLaterTicketOperations')}
            exampleLabel={tr('common.example')}
            rows={[
              { label: 'User', value: 'soc-agent' },
            ]}
            footer={tr('text.dedicatedIntegrationAccountWorksBetter')}
          />
        )} />}>
          <Input value={c.form.username} autoComplete="off" placeholder="soc-agent" onChange={(e) => c.setForm((p) => ({ ...p, username: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text={tr('common.password')} topic="integrationen" hint={(
          <ExampleHint
            title={tr('text.secretAgentAccount')}
            text={tr('settings.youOnlyNeedPasswordWhen')}
            exampleLabel="Praxis"
            rows={[
              { label: tr('common.reset'), value: tr('settings.enterSave') },
              { label: 'Behalten', value: 'leer lassen' },
            ]}
            footer={tr('settings.nexoraNeverDisplaysStoredPassword')}
          />
        )} />}>
          <Input
            type="password"
            value={c.form.otrsPassword}
            autoComplete="new-password"
            placeholder={c.masked?.passwordSet ? '••••••••  (gesetzt - leer = behalten)' : tr('settings.otrsPassword')}
            onChange={(e) => c.setForm((p) => ({ ...p, otrsPassword: e.target.value }))}
          />
        </Field>
      </div>
      <div style={cardStyles.row2}>
        <Field label={<HelpLabel text="Queue" topic="integrationen" hint={(
          <ExampleHint
            title={tr('settings.otrsQueueLabel')}
            text={tr('settings.queueDeterminesWhereExportedCases')}
            exampleLabel={tr('common.example')}
            rows={[
              { label: 'Queue', value: 'Security' },
            ]}
            footer={tr('settings.onlyEnterQueueIntegrationAccount')}
          />
        )} />}>
          <Input value={c.form.queue} autoComplete="off" placeholder="Security" onChange={(e) => c.setForm((p) => ({ ...p, queue: e.target.value }))} />
        </Field>
        <Field label={<HelpLabel text="WebService" topic="integrationen" hint={(
          <ExampleHint
            title={tr('text.nameEnabledGenericinterfaceWebService')}
            text={tr('settings.enterExactWebServiceName')}
            exampleLabel={tr('common.example')}
            rows={[
              { label: 'WebService', value: 'GenericTicketConnectorREST' },
            ]}
            footer={tr('settings.nameMustMatchExactlyOtherwise')}
          />
        )} />}>
          <Input value={c.form.webService} autoComplete="off" placeholder="GenericTicketConnectorREST" onChange={(e) => c.setForm((p) => ({ ...p, webService: e.target.value }))} />
        </Field>
      </div>
      <Field label={<HelpLabel text="Operation" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.whichActionCalledWebService')}
          text={tr('settings.operationNamesSpecificEndpointFunction')}
          exampleLabel={tr('common.example')}
          rows={[
            { label: 'Operation', value: 'TicketCreate' },
          ]}
          footer={tr('settings.operationMustMatchSelectedWeb')}
        />
      )} />}>
        <Input value={c.form.operation} autoComplete="off" placeholder="TicketCreate" onChange={(e) => c.setForm((p) => ({ ...p, operation: e.target.value }))} />
      </Field>
    </ConnectionCardShell>
  );
}
