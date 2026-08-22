import { useCallback, useEffect, useState } from 'react';
import { huntApi } from './huntApi';
import {
  recordPollFailure, recordPollSuccess, INITIAL_POLL_HEALTH, type PollHealth,
} from './pollHealthModel';
import type {
  HuntSession, HuntLog, HuntFinding, HuntCommand,
  HuntResponseAction, HuntArtifact, HuntTicketLink, HuntResponseCircuit,
} from '../../lib/types';

const POLL_MS = 2000;

export interface HuntSessionData {
  session: HuntSession | null;
  logs: HuntLog[];
  findings: HuntFinding[];
  commands: HuntCommand[];
  actions: HuntResponseAction[];
  artifacts: HuntArtifact[];
  ticketLinks: HuntTicketLink[];
  circuit: HuntResponseCircuit | null;
}

const EMPTY_DATA: HuntSessionData = {
  session: null, logs: [], findings: [], commands: [],
  actions: [], artifacts: [], ticketLinks: [], circuit: null,
};

/**
 * Lädt alle Daten einer Hunt-Session und pollt solange sie aktiv / geplant ist.
 * Cleanup (clearInterval) ist garantiert beim Unmount und bei selId-Wechsel.
 *
 * @param selId       - Ausgewählte Session-ID (null = kein Poll).
 * @param onDone      - Callback wenn Session nicht mehr aktiv (z.B. Liste neu laden).
 * @returns data      - Aktuelle Session-Daten.
 * @returns refresh   - Manuelles Nachladen (z.B. nach einer Aktion).
 */
export function useHuntSession(
  selId: string | null,
  onDone: () => void,
): { data: HuntSessionData; refresh: () => Promise<void>; pollDegraded: boolean } {
  const [data, setData] = useState<HuntSessionData>(EMPTY_DATA);
  // Poll-Gesundheit: zählt aufeinanderfolgende Tick-Fehler. Ab Schwelle „degraded"
  // → die Page zeigt einen ehrlichen Fehlerhinweis statt stumm weiterzupollen.
  const [pollHealth, setPollHealth] = useState<PollHealth>(INITIAL_POLL_HEALTH);

  const refresh = useCallback(async (): Promise<void> => {
    if (!selId) return;
    // Best-effort Nachladen NACH einer bereits durchgeführten Aktion. Wirft bewusst
    // NICHT: ein Reload-Fehler hier ist kein Aktions-Fehler — sonst zeigt der Aufrufer
    // fälschlich „Aktion fehlgeschlagen", obwohl die Aktion durch ist. Kein stilles
    // Schlucken: der Fehler fließt in dieselbe Poll-Gesundheit → ehrlicher
    // `pollDegraded`-Hinweis in der Page; der nächste Poll-Tick lädt erneut.
    try {
      const [se, lo, fi, cm, ra, ar, tl, cc] = await Promise.all([
        huntApi.getSession(selId),
        huntApi.logs(selId),
        huntApi.findings(selId),
        huntApi.commands(selId),
        huntApi.responseActions(selId),
        huntApi.artifacts(selId),
        huntApi.ticketLinks(selId),
        huntApi.responseCircuit(),
      ]);
      setData({
        session:     se.data ?? null,
        logs:        lo.data ?? [],
        findings:    fi.data ?? [],
        commands:    cm.data ?? [],
        actions:     ra.data ?? [],
        artifacts:   ar.data ?? [],
        ticketLinks: tl.data ?? [],
        circuit:     cc.data ?? null,
      });
      setPollHealth(recordPollSuccess());
    } catch {
      setPollHealth((prev) => recordPollFailure(prev));
    }
  }, [selId]);

  useEffect(() => {
    if (!selId) {
      setData(EMPTY_DATA);
      setPollHealth(INITIAL_POLL_HEALTH);
      return;
    }
    // Neue Session → Poll-Gesundheit zurücksetzen (kein übernommenes „degraded").
    setPollHealth(INITIAL_POLL_HEALTH);
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const tick = async () => {
      try {
        // Reload directly rather than via `refresh` so we can read the result.
        const [se, lo, fi, cm, ra, ar, tl, cc] = await Promise.all([
          huntApi.getSession(selId),
          huntApi.logs(selId),
          huntApi.findings(selId),
          huntApi.commands(selId),
          huntApi.responseActions(selId),
          huntApi.artifacts(selId),
          huntApi.ticketLinks(selId),
          huntApi.responseCircuit(),
        ]);
        if (!active) return;
        const session = se.data ?? null;
        setData({
          session,
          logs:        lo.data ?? [],
          findings:    fi.data ?? [],
          commands:    cm.data ?? [],
          actions:     ra.data ?? [],
          artifacts:   ar.data ?? [],
          ticketLinks: tl.data ?? [],
          circuit:     cc.data ?? null,
        });
        setPollHealth(recordPollSuccess());
        if (session && session.status !== 'active' && session.status !== 'planned') {
          stop();
          onDone();
        }
      } catch {
        // Kein stilles Verschlucken: Fehler zählen. Ab Schwelle meldet die Page
        // „Poll fehlgeschlagen" statt endlos stumm weiterzupollen.
        if (active) setPollHealth((prev) => recordPollFailure(prev));
      }
    };

    void tick();
    timer = setInterval(() => { if (active) void tick(); }, POLL_MS);
    return () => { active = false; stop(); };
    // onDone ist stabil (useCallback in der Page) — kein Problem in Deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  return { data, refresh, pollDegraded: pollHealth.degraded };
}
