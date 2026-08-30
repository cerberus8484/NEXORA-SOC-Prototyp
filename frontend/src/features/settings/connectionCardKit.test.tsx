import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TestLine } from './connectionCardKit';

// #2: Die Klartext-Warnung (http zu externem Ziel) wird orthogonal zum Verbindungs-
// status gezeigt — auch bei „Verbindung ok", da sie ein Sicherheitshinweis ist.
describe('TestLine — Klartext-Warnung', () => {
  it('zeigt die Warnung zusätzlich zu „Verbindung ok"', () => {
    render(<TestLine result={{ ok: true, latencyMs: 5, warning: 'Klartext-Warnung X' }} />);
    expect(screen.getByText(/Verbindung ok/)).toBeInTheDocument();
    expect(screen.getByText(/Klartext-Warnung X/)).toBeInTheDocument();
  });

  it('zeigt die Warnung auch bei Fehlschlag', () => {
    render(<TestLine result={{ ok: false, reason: 'error', error: 'HTTP 500', warning: 'Klartext-Warnung Y' }} />);
    expect(screen.getByText(/Fehlgeschlagen/)).toBeInTheDocument();
    expect(screen.getByText(/Klartext-Warnung Y/)).toBeInTheDocument();
  });

  it('ohne Warnung → nur der Status, kein Warntext', () => {
    render(<TestLine result={{ ok: true, latencyMs: 5 }} />);
    expect(screen.getByText(/Verbindung ok/)).toBeInTheDocument();
    expect(screen.queryByText(/Klartext/)).not.toBeInTheDocument();
  });
});
