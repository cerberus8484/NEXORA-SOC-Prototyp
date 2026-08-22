import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpTip } from './HelpTip';
import { WIKI_TOPICS } from '../../lib/wikiTopics';

describe('HelpTip', () => {
  it('zeigt den Registry-Hinweis des Topics beim Fokussieren', () => {
    render(<HelpTip topic="integrationen" />);
    fireEvent.focus(screen.getByRole('button', { name: /Erklaerung/i }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(WIKI_TOPICS.integrationen.hint.slice(0, 20));
  });

  it('ueberschreibt den Hinweis, wenn hint gesetzt ist', () => {
    render(<HelpTip topic="mfa" hint="Eigener Kontext-Hinweis" />);
    fireEvent.focus(screen.getByRole('button', { name: /Erklaerung/i }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Eigener Kontext-Hinweis');
  });

  it('rendert einen internen more-Link ins Nexora-Wiki', () => {
    render(<HelpTip topic="sicherheit" />);
    fireEvent.focus(screen.getByRole('button', { name: /Erklaerung/i }));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/wiki/admin/sicherheit');
  });
});
