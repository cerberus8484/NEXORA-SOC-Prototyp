import { Radar } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchQradarConnection, saveQradarConnection, testQradarConnection } from './settingsApi';
import {
  qradarFormFromMasked, buildQradarPatch, qradarConnError, qradarSourceLabel,
  type QradarMasked, type QradarForm, type QradarPatch,
} from './qradarConnectionModel';
import { useConnectionCard, ConnectionCardShell } from './connectionCardKit';
import { useTranslation } from 'react-i18next';

// QRadar-Verbindung (Layer 2): Base-URL + API-Token admin-seitig verwalten —
// Token verschlüsselt in der DB, ENV bleibt Fallback. Speichern mit Passwort-Step-up;
// Verbindungstest speichert nichts. Ablauf/Shell in connectionCardKit.

/** QRadar-Verbindungs-Karte (admin-only, Settings → Integrationen). */
export function QradarConnectionCard() {
  const { t: tr } = useTranslation();
  const c = useConnectionCard<QradarMasked, QradarForm, QradarPatch>({
    fetchConnection: fetchQradarConnection,
    saveConnection: saveQradarConnection,
    testConnection: (f) => testQradarConnection({ baseUrl: f.baseUrl.trim(), token: f.token }),
    formFromMasked: qradarFormFromMasked,
    buildPatch: buildQradarPatch,
    connError: qradarConnError,
    emptyForm: { baseUrl: '', token: '' },
    emptyPatch: { baseUrl: '', token: '' },
    loadErrorText: tr('settings.qradarConnectionCouldNotLoaded'),
    successText: tr('settings.qradarConnectionSavedActiveImmediately'),
    testErrorText: (status) => (status === 400 ? tr('settings.invalidUrlHttpsOnly') : tr('settings.testFailedDot')),
    saveErrorText: (status) => (status === 400 ? tr('settings.saveRejectedInvalidInputHttps') : tr('common.savingFailed')),
  });

  return (
    <ConnectionCardShell
      title={tr('settings.qradarConnection')}
      icon={<Radar size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>{tr('settings.qradarIntro')}</>}
      sourceLabel={qradarSourceLabel}
      dialogTitle={tr('settings.confirmQradarConnection')}
      dialogDescription={tr('settings.confirmYourPasswordSaveQradar')}
      controller={c}
    >
      <Field label={<HelpLabel text="Base-URL (https)" topic="integrationen" hint={(
        <ExampleHint
          title={tr('settings.addressQradarRestApi')}
          text={tr('settings.enterHttpsBaseAddressQradar')}
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'https://qradar.intern' },
            { label: 'API-Pfad', value: tr('settings.apiAppendedInternally') },
          ]}
          footer={tr('settings.doNotEnterSingleResource')}
        />
      )} />}>
        <Input value={c.form.baseUrl} placeholder="https://qradar.intern" onChange={(e) => c.setForm((p) => ({ ...p, baseUrl: e.target.value }))} />
      </Field>
      <Field label={<HelpLabel text="API-Token (SEC)" topic="integrationen" hint={(
        <ExampleHint
          title={tr('text.technicalAccessTokenQradar')}
          text={tr('settings.secHeaderTokenNexoraAuthenticates')}
          exampleLabel="Praxis"
          rows={[
            { label: tr('common.source'), value: 'QRadar API Token' },
            { label: tr('common.usage'), value: 'eintragen, leer = behalten' },
          ]}
          footer={tr('settings.issueTokenNexoraOnlyDo')}
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
