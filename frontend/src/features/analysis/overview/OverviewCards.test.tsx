import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EMPTY_EVIDENCE, type ParsedEvidence } from '../analysisModel';
import type { Ticket } from '../../../lib/types';
import {
  EvidencePreviewCard, EventPreviewCard, PayloadPreviewCard,
  TopConversationsCard, EventTimelinePreviewCard,
} from './OverviewCards';

// Overview-Preview-Karten: ehrliche Leerzustände („—"), keine Fake-Werte, Footer verlinkt Detail-Tabs.
const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1', ticketNr: 'INC1', title: 'T', priority: 'high', status: 'assigned', analyst: 'a',
  createdAt: '2026-06-22T10:00:00Z', updatedAt: '2026-06-22T11:00:00Z', ...over,
});
const ev = (over: Partial<ParsedEvidence>): ParsedEvidence => ({ ...EMPTY_EVIDENCE, ...over });

describe('EvidencePreviewCard', () => {
  it('zeigt „—" für fehlende Datei-Evidence statt erfundener Werte', () => {
    render(<EvidencePreviewCard ev={EMPTY_EVIDENCE} />);
    expect(screen.getByText('Evidence Preview')).toBeInTheDocument();
    expect(screen.getByText('File Type')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
  it('leitet den File Type aus der Endung ab und verlinkt den Footer', async () => {
    const onFooter = vi.fn();
    render(<EvidencePreviewCard ev={ev({ file: { name: 'C:\\Temp\\x.ps1' } })} onFooter={onFooter} />);
    expect(screen.getByText('PowerShell Script')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View all evidence/i }));
    expect(onFooter).toHaveBeenCalledOnce();
  });
});

describe('EventPreviewCard', () => {
  it('zeigt Windows-Event-Felder bzw. „—"', () => {
    render(<EventPreviewCard ev={ev({ windowsEvent: { eventId: '11', provider: 'Microsoft-Windows-Sysmon', channel: 'Sysmon/Operational' } })} />);
    expect(screen.getByText('Microsoft-Windows-Sysmon')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
  });
});

describe('PayloadPreviewCard', () => {
  it('wechselt zwischen Normalized und Raw und zeigt ehrlichen Leer-Raw', async () => {
    render(<PayloadPreviewCard ev={ev({ source: { ip: '10.0.0.1' }, destination: { ip: '203.0.113.45', port: 443 }, network: { protocol: 'tcp' } })} />);
    expect(screen.getByText('Destination IP')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText(/Kein Roh-Payload/i)).toBeInTheDocument();
  });
});

describe('TopConversationsCard', () => {
  it('zeigt ehrlichen Leerzustand ohne Flows', () => {
    render(<TopConversationsCard t={ticket()} ev={EMPTY_EVIDENCE} tl={null} network={null} tlLoading={false} />);
    expect(screen.getByText('Top Conversations (Preview)')).toBeInTheDocument();
    expect(screen.getByText(/Keine korrelierten Netzwerk-Flows/i)).toBeInTheDocument();
  });
});

describe('EventTimelinePreviewCard', () => {
  it('zeigt ehrlichen Leerzustand ohne ableitbare Events', () => {
    render(<EventTimelinePreviewCard t={ticket()} ev={EMPTY_EVIDENCE} tl={null} network={null} tlLoading={false} />);
    expect(screen.getByText('Event Timeline (Preview)')).toBeInTheDocument();
    expect(screen.getByText(/Keine Timeline-Events/i)).toBeInTheDocument();
  });
});
