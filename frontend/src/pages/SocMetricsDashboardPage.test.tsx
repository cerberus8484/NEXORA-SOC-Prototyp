import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let currentRole = 'engineer';
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: currentRole, displayName: 'Eng' } }),
}));

vi.mock('../features/metrics/socMetricsApi', async () => {
  const actual = await vi.importActual<typeof import('../features/metrics/socMetricsApi')>(
    '../features/metrics/socMetricsApi',
  );
  return { ...actual, socMetricsApi: { get: vi.fn() } };
});

import { socMetricsApi, type SocMetrics } from '../features/metrics/socMetricsApi';
import { SocMetricsDashboardPage } from './SocMetricsDashboardPage';

const mGet = socMetricsApi.get as unknown as ReturnType<typeof vi.fn>;

const metrics: SocMetrics = {
  mttr: { meanMs: 3600000, medianMs: 3600000, sampleSize: 4 },
  fpRate: { rate: 0.25, fpCount: 1, classifiedCount: 4 },
  byState: { OPEN: 5, CLOSED: 4 },
  byStatus: { assigned: 3 },
  topRules: [{ key: 'rule:100', count: 2 }],
  analystLoad: [{ analyst: 'alice', total: 3, open: 1 }],
  meta: { totalTickets: 9, sampledTickets: 9, capped: false, since: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  currentRole = 'engineer';
  mGet.mockResolvedValue({ success: true, data: metrics });
});

describe('SocMetricsDashboardPage', () => {
  it('lädt beim Mount mit dem 30-Tage-Default (since gesetzt)', async () => {
    render(<SocMetricsDashboardPage />);
    await screen.findByText('FP / klassifiziert geschlossen');
    expect(mGet).toHaveBeenCalledTimes(1);
    const since = mGet.mock.calls[0][0];
    expect(since).not.toBeNull(); // 30d → konkreter ISO-Zeitstempel
  });

  it('zeigt den FP-Nenner ehrlich als "klassifiziert" (Audit #3)', async () => {
    render(<SocMetricsDashboardPage />);
    expect(await screen.findByText('1/4 klassifiziert')).toBeInTheDocument();
  });

  it('Zeitraumwechsel auf "Alle" lädt neu mit since=null (Audit #2)', async () => {
    render(<SocMetricsDashboardPage />);
    await screen.findByText('FP / klassifiziert geschlossen');
    fireEvent.click(screen.getByRole('button', { name: 'Alle' }));
    await waitFor(() => expect(mGet).toHaveBeenCalledTimes(2));
    expect(mGet.mock.calls[1][0]).toBeNull();
  });

  it('Zeitraumwechsel auf "7 Tage" lädt neu mit gesetztem since', async () => {
    render(<SocMetricsDashboardPage />);
    await screen.findByText('FP / klassifiziert geschlossen');
    fireEvent.click(screen.getByRole('button', { name: '7 Tage' }));
    await waitFor(() => expect(mGet).toHaveBeenCalledTimes(2));
    expect(mGet.mock.calls[1][0]).not.toBeNull();
  });

  it('Aktualisieren-Button lädt den aktiven Zeitraum neu (Audit #5)', async () => {
    render(<SocMetricsDashboardPage />);
    await screen.findByText('FP / klassifiziert geschlossen');
    fireEvent.click(screen.getByRole('button', { name: 'Metriken aktualisieren' }));
    await waitFor(() => expect(mGet).toHaveBeenCalledTimes(2));
  });

  it('zeigt den konkreten Fehlergrund an statt eines generischen Textes (Audit #4)', async () => {
    mGet.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    render(<SocMetricsDashboardPage />);
    expect(await screen.findByText('503 Service Unavailable')).toBeInTheDocument();
  });

  it('verweigert Nicht-Engineer den Zugriff ehrlich und lädt nichts', async () => {
    currentRole = 'analyst';
    render(<SocMetricsDashboardPage />);
    expect(await screen.findByText('Zugriff verweigert')).toBeInTheDocument();
    expect(mGet).not.toHaveBeenCalled();
  });
});
