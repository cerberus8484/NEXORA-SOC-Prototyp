import type { MlEvalSnapshotMeta, RoutingPolicyStatus } from './mlEvalApi';

export interface PolicyExplainCard {
  tone: 'success' | 'warning' | 'muted';
  title: string;
  body: string;
}

export interface SnapshotExplainCard {
  tone: 'success' | 'warning' | 'muted';
  title: string;
  body: string;
}

export function explainRoutingPolicy(policy: RoutingPolicyStatus | null | undefined): PolicyExplainCard {
  if (!policy || !policy.active) {
    return {
      tone: 'warning',
      title: 'Routing aktuell aus',
      body: 'Die KI darf im Moment keine Routing-Empfehlung aus der ML-Policy ableiten. Es passiert nichts automatisch.',
    };
  }

  return {
    tone: 'success',
    title: 'Routing-Hinweis aktiv',
    body: `KI-Vorschlaege mit Score ab ${policy.threshold ?? 0} duerfen als Hinweis markiert werden. Auch dann bleibt alles advisory und braucht einen Menschen.`,
  };
}

export function explainSnapshot(snapshot: MlEvalSnapshotMeta | null | undefined): SnapshotExplainCard {
  if (!snapshot) {
    return {
      tone: 'muted',
      title: 'Noch kein Snapshot geladen',
      body: 'Erst nach Klick auf "Snapshot erzeugen" siehst du, wie viele reviewte ML-Daten aktuell fuer die Offline-Evaluation verfuegbar sind.',
    };
  }

  if (snapshot.returned === 0) {
    return {
      tone: 'warning',
      title: 'Noch keine Eval-Daten',
      body: 'Es gibt noch keine reviewten KI-Vorschlaege oder geschlossenen Tickets im Snapshot. Ohne diese Daten bleibt ML-Routing bewusst aus.',
    };
  }

  if (snapshot.returned < 20) {
    return {
      tone: 'warning',
      title: 'Noch duenne Datenbasis',
      body: `${snapshot.returned} Datensaetze sind sichtbar. Das reicht oft noch nicht fuer belastbare Routing-Entscheidungen - mehr reviewte Faelle sind besser.`,
    };
  }

  return {
    tone: 'success',
    title: 'Snapshot brauchbar fuer den naechsten Check',
    body: `${snapshot.returned} Datensaetze sind im Snapshot. Damit kannst du die Offline-Evaluation und danach den Routing-Gate-Check fahren.`,
  };
}
