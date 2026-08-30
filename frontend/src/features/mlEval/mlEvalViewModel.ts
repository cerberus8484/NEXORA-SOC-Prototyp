import type { MlEvalSnapshotMeta, RoutingPolicyStatus } from './mlEvalApi';
import i18n from '../../i18n';

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
      title: i18n.t('mlEval.routingCurrentlyOff'),
      body: i18n.t('app.aiMayNotDeriveRouting'),
    };
  }

  return {
    tone: 'success',
    title: i18n.t('text.routingHintActive'),
    body: i18n.t('mlEval.routingHintBody', { threshold: policy.threshold ?? 0 }),
  };
}

export function explainSnapshot(snapshot: MlEvalSnapshotMeta | null | undefined): SnapshotExplainCard {
  if (!snapshot) {
    return {
      tone: 'muted',
      title: i18n.t('app.noSnapshotLoadedYet'),
      body: i18n.t('text.onlyAfterClickingCreateSnapshot'),
    };
  }

  if (snapshot.returned === 0) {
    return {
      tone: 'warning',
      title: i18n.t('app.noEvaluationDataYet'),
      body: i18n.t('app.thereNoReviewedAiSuggestions'),
    };
  }

  if (snapshot.returned < 20) {
    return {
      tone: 'warning',
      title: i18n.t('text.dataBasisStillThin'),
      body: i18n.t('mlEval.thinDataBody', { count: snapshot.returned }),
    };
  }

  return {
    tone: 'success',
    title: i18n.t('app.snapshotUsableNextCheck'),
    body: i18n.t('mlEval.snapshotUsableBody', { count: snapshot.returned }),
  };
}
