import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../../../lib/types';
import { EMPTY_EVIDENCE, type ParsedEvidence } from '../analysisModel';
import { TimelineInspector, TimelineView } from './TimelineView';
import { buildTimelineGroups } from './timelineModel';

const ticket: Ticket = {
  id: 'tkt-1', ticketNr: 'INC000460', title: 'Executable file dropped', priority: 'critical',
  status: 'open', analyst: '', createdAt: '2026-06-20T16:49:32Z', updatedAt: '2026-06-20T16:50:12Z',
};
const evidence: ParsedEvidence = {
  ...EMPTY_EVIDENCE,
  detection: { sourceSystem: 'Wazuh', timestamp: '2026-06-20T16:49:32Z', ruleId: '92213' },
  process: { image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
};

describe('TimelineView', () => {
  it('selects an event group through a semantic button', () => {
    const onSelectEvent = vi.fn();
    render(<TimelineView t={ticket} ev={evidence} tl={null} loading={false} selectedEventId={null} onSelectEvent={onSelectEvent} />);

    fireEvent.click(screen.getByRole('button', { name: /Process created: powershell\.exe/i }));

    expect(onSelectEvent).toHaveBeenCalledWith('process');
  });

  it('shows selected event details in the context inspector', () => {
    const event = buildTimelineGroups(ticket, evidence, null)[0];
    render(<TimelineInspector event={event} onOpenNetwork={vi.fn()} />);

    expect(screen.getByText('Event Inspector')).toBeInTheDocument();
    expect(screen.getByText('Process created: powershell.exe')).toBeInTheDocument();
  });
});
