import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./servicesApi', () => ({
  servicesApi: {
    getWazuhConnection: vi.fn(),
    testWazuhConnection: vi.fn(),
    saveWazuhConnection: vi.fn(),
  },
}));

import { WazuhConnectionCard } from './WazuhConnectionCard';
import { servicesApi } from './servicesApi';

const masked = {
  api: { source: 'env' as const, url: 'https://wazuh-api.local:55000', user: 'nexora-api', passwordSet: true },
  indexer: { source: 'env' as const, url: 'https://wazuh-indexer.local:9200', user: 'nexora-indexer', passwordSet: true },
};

describe('WazuhConnectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(servicesApi.getWazuhConnection).mockResolvedValue({ data: masked } as never);
  });

  it('zeigt an den Wazuh-Feldern konkrete Hilfebeispiele', async () => {
    render(<WazuhConnectionCard />);

    expect(await screen.findByText(/Wazuh-Verbindung/i)).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getAllByLabelText(/URL erklaeren/i)[0]);

    expect(await screen.findByText(/Wohin Nexora die Wazuh-Sektion verbindet/i)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/wazuh\.nexora\.local:55000/i)).toBeInTheDocument();
  });
});
