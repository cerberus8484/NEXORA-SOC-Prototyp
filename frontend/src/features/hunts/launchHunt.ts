import type { CreateHuntBody } from './huntApi';
import i18n from '../../i18n';

// P_TRUST_1 · A2 — „Hunt starten" muss die Hunt WIRKLICH starten.
// Vorher legte die Hunt-Library nur eine Session an (Draft) und navigierte — start()
// fehlte → die Hunt lief nie. Hier: Session anlegen → DANN starten. Ohne Session-ID
// ein klarer Fehler (kein stiller Draft). Minimaler Vertrag → ohne Render testbar.
export interface HuntLauncher {
  createSession: (body: CreateHuntBody) => Promise<{ data?: { id?: string } }>;
  start: (id: string) => Promise<unknown>;
}

export async function launchHunt(api: HuntLauncher, body: CreateHuntBody): Promise<string> {
  const res = await api.createSession(body);
  const id = res.data?.id;
  if (!id) throw new Error(i18n.t('ui.huntCouldNotCreatedNo'));
  await api.start(id); // ← der eigentliche Fix: Hunt aktiv schalten statt nur Draft
  return id;
}
