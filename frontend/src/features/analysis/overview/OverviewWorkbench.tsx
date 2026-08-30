import type { Ticket } from '../../../lib/types';
import type { ParsedEvidence, TicketTimeline, NetworkCorrelation, CorrelationStatusInfo, ThreatIntelResult } from '../analysisModel';
import type { EntityItem, SummaryBullet, RiskModel } from '../deckModel';
import type { DeckSection } from '../deck/AnalysisSubNav';
import type { CollectEvidenceFeedback } from '../../evidence/collectEvidenceFeedback';
import { CaseHeader } from './CaseHeader';
import { GRID_2 } from './overviewUi';
import {
  EvidencePreviewCard, EventPreviewCard, PayloadPreviewCard,
  TopConversationsCard, CommunicationMapCard, EventTimelinePreviewCard,
} from './OverviewCards';
import { OverviewDecisionRail, type RailHandlers } from './OverviewRail';

export interface OverviewWorkbenchProps {
  t: Ticket; ev: ParsedEvidence; tl: TicketTimeline | null; network: NetworkCorrelation | null; tlLoading: boolean;
  risk: RiskModel | null; bullets: SummaryBullet[]; entities: EntityItem[];
  correlationStatus?: CorrelationStatusInfo; tiResult: ThreatIntelResult | null; confidence?: number | null;
  canAct: boolean; canAdmin: boolean; busy: boolean; collecting: boolean; collectFeedback: CollectEvidenceFeedback | null;
  onOpenSection: (s: DeckSection) => void; onMitre: () => void;
  onCollect: () => void; onClose: () => void; onDelete: () => void;
  rail: RailHandlers;
}

export function OverviewWorkbench(p: OverviewWorkbenchProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 14, alignItems: 'start' }}>
      {/* Main Content (~78–80 %) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <CaseHeader t={p.t} ev={p.ev} tl={p.tl} canAct={p.canAct} canAdmin={p.canAdmin} busy={p.busy}
          collecting={p.collecting} collectFeedback={p.collectFeedback}
          onCollect={p.onCollect} onClose={p.onClose} onDelete={p.onDelete} />

        <div style={GRID_2}>
          <EvidencePreviewCard ev={p.ev} onFooter={() => p.onOpenSection('evidence')} />
          <EventPreviewCard ev={p.ev} onFooter={() => p.onOpenSection('timeline')} />
          <TopConversationsCard t={p.t} ev={p.ev} tl={p.tl} network={p.network} tlLoading={p.tlLoading} onFooter={() => p.onOpenSection('network')} />
          <CommunicationMapCard ev={p.ev} t={p.t} tl={p.tl} network={p.network} onFooter={() => p.onOpenSection('network')} />
          <PayloadPreviewCard ev={p.ev} onFooter={() => p.onOpenSection('payloads')} />
          <EventTimelinePreviewCard t={p.t} ev={p.ev} tl={p.tl} network={p.network} tlLoading={p.tlLoading} onFooter={() => p.onOpenSection('timeline')} />
        </div>
      </div>

      {/* Right Decision Rail (~20–22 %) — helle, ruhige Cards (kein Panel) */}
      <OverviewDecisionRail bullets={p.bullets} ev={p.ev} risk={p.risk} tiResult={p.tiResult} confidence={p.confidence} h={p.rail} />
    </div>
  );
}
