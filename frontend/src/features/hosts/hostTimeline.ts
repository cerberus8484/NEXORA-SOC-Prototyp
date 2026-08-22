// ─────────────────────────────────────────────────────────────────────────
// Host Alert-History → Timeline-Modell (pure, testbar ohne Rendering)
// Quelle: GET /v1/hosts/:agentId/alerts (Ticket-Zusammenfassungen)
// ─────────────────────────────────────────────────────────────────────────

export type AlertPriority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface HostAlert {
  id: string;
  ticketNr?: string;
  title?: string;
  priority?: string;
  state?: string;
  status?: string;
  mitre?: string;
  offenseId?: string;
  description?: string;
  createdAt?: string;
}

export interface TimelineItem {
  id: string;
  ticketNr: string;
  title: string;
  priority: AlertPriority;
  color: string;       // CSS-Variable je Schweregrad
  createdAt: string;
  mitre: string;
}

const PRIORITIES: AlertPriority[] = ['critical', 'high', 'medium', 'low', 'info'];

// Schweregrad-Farbe: kritisch=rot, hoch=orange, mittel=gelb, low/info=grau.
export function severityColor(priority?: string): string {
  switch (priority) {
    case 'critical': return 'var(--danger)';
    case 'high':     return 'var(--accent-orange)';
    case 'medium':   return 'var(--warning)';
    default:         return 'var(--text-muted)';
  }
}

function normalisePriority(priority?: string): AlertPriority {
  const p = String(priority || '').toLowerCase();
  return (PRIORITIES as string[]).includes(p) ? (p as AlertPriority) : 'info';
}

// Alerts → sortierte Timeline (neueste zuerst), mit Severity-Farbe.
export function buildTimeline(alerts: HostAlert[]): TimelineItem[] {
  return alerts
    .map((a) => {
      const priority = normalisePriority(a.priority);
      return {
        id:        a.id,
        ticketNr:  a.ticketNr || '',
        title:     a.title || 'Ohne Titel',
        priority,
        color:     severityColor(priority),
        createdAt: a.createdAt || '',
        mitre:     a.mitre || '',
      };
    })
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}
