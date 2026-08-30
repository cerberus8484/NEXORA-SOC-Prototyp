import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutonomyPoliciesPage } from './AutonomyPoliciesPage';

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin', displayName: 'Tester' } }),
}));

vi.mock('../features/autonomy/autonomyApi', () => ({
  ACTION_CLASS_CEILINGS: {
    enrichment: 'autonomous',
    internal_state: 'assisted',
    draft_generation: 'assisted',
    detection_write: 'advisory',
    host_response: 'advisory',
    external_comms: 'advisory',
  },
  isCeilingViolation: vi.fn(() => false),
  autonomyApi: {
    getStatus: vi.fn(),
    listPolicies: vi.fn(),
    createPolicy: vi.fn(),
    updatePolicy: vi.fn(),
    deletePolicy: vi.fn(),
  },
}));

import { autonomyApi } from '../features/autonomy/autonomyApi';

const mGetStatus = autonomyApi.getStatus as ReturnType<typeof vi.fn>;
const mListPolicies = autonomyApi.listPolicies as ReturnType<typeof vi.fn>;

describe('AutonomyPoliciesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mGetStatus.mockResolvedValue({ data: { enabled: false } });
    mListPolicies.mockResolvedValue({ data: [] });
  });

  it('erklaert im Policy-Dialog wichtige Felder mit echten Beispielwerten', async () => {
    render(<AutonomyPoliciesPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Policy anlegen/i }));

    const trigger = screen.getByLabelText(/Mandant \(customer\).+erklaeren/i);
    fireEvent.mouseEnter(trigger);

    expect(await screen.findByText(/Fuer wen diese Policy gilt/i)).toBeInTheDocument();
    expect(screen.getByText('kunde-nord')).toBeInTheDocument();
  });
});
