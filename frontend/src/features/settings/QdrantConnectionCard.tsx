import { Database } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchQdrantConnection, saveQdrantConnection, testQdrantConnection } from './settingsApi';
import {
  qdrantFormFromMasked, buildQdrantPatch, qdrantConnError, qdrantSourceLabel,
  type QdrantMasked, type QdrantForm, type QdrantPatch,
} from './qdrantConnectionModel';
import { useConnectionCard, ConnectionCardShell } from './connectionCardKit';
import { useTranslation } from 'react-i18next';

// Qdrant-Verbindung (Layer 2): URL + optionaler API-Key des Vektor-Stores admin-
// seitig verwalten — Key verschlüsselt in der DB, ENV bleibt Fallback. Speichern
// mit Passwort-Step-up; Test speichert nichts. Ablauf/Shell in connectionCardKit.

/** Qdrant-Verbindungs-Karte (admin-only, Settings → Integrationen). */
export function QdrantConnectionCard() {
  const { t: tr } = useTranslation();
  const c = useConnectionCard<QdrantMasked, QdrantForm, QdrantPatch>({
    fetchConnection: fetchQdrantConnection,
    saveConnection: saveQdrantConnection,
    testConnection: (f) => testQdrantConnection({ url: f.url.trim(), apiKey: f.apiKey }),
    formFromMasked: qdrantFormFromMasked,
    buildPatch: buildQdrantPatch,
    connError: qdrantConnError,
    emptyForm: { url: '', apiKey: '' },
    emptyPatch: { url: '', apiKey: '' },
    loadErrorText: tr('settings.qdrantConnectionCouldNotLoaded'),
    successText: tr('settings.qdrantConnectionSavedActiveImmediately'),
    testErrorText: (status) => (status === 400 ? tr('settings.invalidUrlInternalHostsOnly') : tr('settings.testFailedDot')),
    saveErrorText: (status) => (status === 400 ? tr('settings.saveRejectedUrlMustInternal') : tr('common.savingFailed')),
  });

  return (
    <ConnectionCardShell
      title={tr('settings.qdrantConnectionTitle')}
      icon={<Database size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>{tr('settings.qdrantIntro')}</>}
      sourceLabel={qdrantSourceLabel}
      dialogTitle={tr('settings.confirmQdrantConnection')}
      dialogDescription={tr('settings.confirmYourPasswordSaveQdrant')}
      controller={c}
    >
      <Field label={<HelpLabel text="URL" topic="integrationen" hint={(
        <ExampleHint
          title={tr('text.addressInternalQdrantService')}
          text={tr('settings.urlQdrantVectorStoreNexora')}
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'http://10.0.10.40:6333' },
            { label: 'Alternativ', value: 'http://qdrant.service.local:6333' },
          ]}
          footer={tr('text.qdrantShouldStayInternalDo')}
        />
      )} />}>
        <Input value={c.form.url} placeholder="http://10.0.10.40:6333" onChange={(e) => c.setForm((p) => ({ ...p, url: e.target.value }))} />
      </Field>
      <Field label={<HelpLabel text="API-Key (optional)" topic="integrationen" hint={(
        <ExampleHint
          title={tr('text.optionalSecretProtectedQdrantAccess')}
          text={tr('settings.fillOnlyIfYourInternal')}
          exampleLabel="Beispiel"
          rows={[
            { label: tr('settings.withoutKey'), value: tr('settings.leaveFieldEmpty') },
            { label: tr('text.key'), value: tr('settings.setSave') },
          ]}
          footer={tr('settings.emptyKeyMeansNoKey')}
        />
      )} />}>
        <Input
          type="password"
          value={c.form.apiKey}
          autoComplete="new-password"
          placeholder={c.masked?.apiKeySet ? '••••••••  (gesetzt — leer = behalten)' : tr('settings.noKeyOptional')}
          onChange={(e) => c.setForm((p) => ({ ...p, apiKey: e.target.value }))}
        />
      </Field>
    </ConnectionCardShell>
  );
}
