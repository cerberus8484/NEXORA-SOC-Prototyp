// Reine, testbare Playbook-Fortschrittslogik. Quelle: analystState.playbook ({ step, status }).
// Das Modell trägt einen aktuellen Step-Index + Status; davor = erledigt, danach = offen.
// Keine erfundenen Match-Scores/Owner/Approvals.

export type PlaybookStepState = 'done' | 'in_progress' | 'skipped' | 'needs_review' | 'current' | 'pending';

/** Status einer Step-Zeile aus aktuellem Index + Status des aktiven Steps. */
export function stepStatus(index: number, currentStep: number, status?: string): PlaybookStepState {
  if (index < currentStep) return 'done';
  if (index > currentStep) return 'pending';
  return (status as PlaybookStepState) || 'current';
}

export interface PlaybookProgress { total: number; done: number; current: number; pending: number; pct: number }

/** Fortschritt eines Playbooks aus Gesamtzahl, aktuellem Step und dessen Status. */
export function playbookProgress(total: number, currentStep: number, status?: string): PlaybookProgress {
  const t = Math.max(0, total);
  if (t === 0) return { total: 0, done: 0, current: 0, pending: 0, pct: 0 };
  const cs = Math.max(0, Math.min(currentStep, t - 1));
  let done = cs;            // alle Steps vor dem aktuellen gelten als erledigt
  let current = 1;
  if (status === 'done') { done = cs + 1; current = 0; }
  else if (status === 'skipped') { current = 0; } // übersprungen zählt nicht als erledigt
  const pending = Math.max(0, t - done - current);
  const pct = Math.round((done / t) * 100);
  return { total: t, done, current, pending, pct };
}
