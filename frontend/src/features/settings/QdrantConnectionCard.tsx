import { Database } from 'lucide-react';
import { Field, Input, HelpLabel, ExampleHint } from '../../components/ui';
import { fetchQdrantConnection, saveQdrantConnection, testQdrantConnection } from './settingsApi';
import {
  qdrantFormFromMasked, buildQdrantPatch, qdrantConnError, qdrantSourceLabel,
  type QdrantMasked, type QdrantForm, type QdrantPatch,
} from './qdrantConnectionModel';
import { useConnectionCard, ConnectionCardShell } from './connectionCardKit';

// Qdrant-Verbindung (Layer 2): URL + optionaler API-Key des Vektor-Stores admin-
// seitig verwalten — Key verschlüsselt in der DB, ENV bleibt Fallback. Speichern
// mit Passwort-Step-up; Test speichert nichts. Ablauf/Shell in connectionCardKit.

/** Qdrant-Verbindungs-Karte (admin-only, Settings → Integrationen). */
export function QdrantConnectionCard() {
  const c = useConnectionCard<QdrantMasked, QdrantForm, QdrantPatch>({
    fetchConnection: fetchQdrantConnection,
    saveConnection: saveQdrantConnection,
    testConnection: (f) => testQdrantConnection({ url: f.url.trim(), apiKey: f.apiKey }),
    formFromMasked: qdrantFormFromMasked,
    buildPatch: buildQdrantPatch,
    connError: qdrantConnError,
    emptyForm: { url: '', apiKey: '' },
    emptyPatch: { url: '', apiKey: '' },
    loadErrorText: 'Qdrant-Verbindung konnte nicht geladen werden.',
    successText: 'Qdrant-Verbindung gespeichert — sofort aktiv, ohne Neustart. Die Änderung wurde protokolliert.',
    testErrorText: (status) => (status === 400 ? 'Ungültige URL (nur interne Hosts).' : 'Test fehlgeschlagen.'),
    saveErrorText: (status) => (status === 400 ? 'Speichern abgelehnt: URL muss intern sein.' : 'Speichern fehlgeschlagen.'),
  });

  return (
    <ConnectionCardShell
      title="Qdrant-Verbindung (RAG)"
      icon={<Database size={15} style={{ color: 'var(--accent)' }} />}
      hint={<>URL des Qdrant-Vektor-Stores (RAG) + optionaler API-Key — Key verschlüsselt in der Datenbank,
        sofort wirksam. Falls noch ein vorhandener Systemwert existiert, greift er nur ohne UI-Eintrag. Qdrant ist ein interner Dienst
        (nur localhost/RFC-1918). Leeres Key-Feld = gespeicherten behalten.</>}
      sourceLabel={qdrantSourceLabel}
      dialogTitle="Qdrant-Verbindung bestätigen"
      dialogDescription="Zum Speichern der Qdrant-Verbindung dein Passwort bestätigen. Ein API-Key wird verschlüsselt gespeichert; die Änderung wird protokolliert und wirkt sofort."
      controller={c}
    >
      <Field label={<HelpLabel text="URL" topic="integrationen" hint={(
        <ExampleHint
          title="Adresse des internen Qdrant-Dienstes"
          text="Hier steht die URL des Qdrant-Vektorspeichers, den Nexora fuer RAG-Abfragen nutzt."
          exampleLabel="Beispiel"
          rows={[
            { label: 'URL', value: 'http://10.0.10.40:6333' },
            { label: 'Alternativ', value: 'http://qdrant.service.local:6333' },
          ]}
          footer="Qdrant soll intern bleiben. Keine externe Internet-Adresse eintragen."
        />
      )} />}>
        <Input value={c.form.url} placeholder="http://10.0.10.40:6333" onChange={(e) => c.setForm((p) => ({ ...p, url: e.target.value }))} />
      </Field>
      <Field label={<HelpLabel text="API-Key (optional)" topic="integrationen" hint={(
        <ExampleHint
          title="Optionales Secret fuer geschuetzten Qdrant-Zugriff"
          text="Nur ausfuellen, wenn euer interner Qdrant wirklich mit API-Key abgesichert ist."
          exampleLabel="Beispiel"
          rows={[
            { label: 'Ohne Key', value: 'Feld leer lassen' },
            { label: 'Mit Key', value: 'setzen und speichern' },
          ]}
          footer="Ein leeres Feld bedeutet hier nicht Fehler, sondern bewusst 'kein API-Key genutzt'."
        />
      )} />}>
        <Input
          type="password"
          value={c.form.apiKey}
          autoComplete="new-password"
          placeholder={c.masked?.apiKeySet ? '••••••••  (gesetzt — leer = behalten)' : 'kein Key / optional'}
          onChange={(e) => c.setForm((p) => ({ ...p, apiKey: e.target.value }))}
        />
      </Field>
    </ConnectionCardShell>
  );
}
