import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('zeigt Hint bei Fokus und oeffnet externe more-Links sicher in neuem Tab', async () => {
    const user = userEvent.setup();
    render(<Tooltip hint="Erklaert die Funktion" moreHref="https://wiki.example/x" label="Hilfe" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.tab();
    const bubble = await screen.findByRole('tooltip');
    expect(bubble).toHaveTextContent('Erklaert die Funktion');
    const link = screen.getByRole('link', { name: /mehr erfahren/i });
    expect(link).toHaveAttribute('href', 'https://wiki.example/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('laesst interne Wiki-Links in Nexora im selben Tab', async () => {
    const user = userEvent.setup();
    render(<Tooltip hint="H" moreHref="/wiki/administration/integrationen" />);
    await user.tab();
    await screen.findByRole('tooltip');
    const link = screen.getByRole('link', { name: /mehr erfahren/i });
    expect(link).toHaveAttribute('href', '/wiki/administration/integrationen');
    expect(link).not.toHaveAttribute('target');
  });

  it('ohne moreHref kein Link; unsicheres Schema wird verworfen', async () => {
    const user = userEvent.setup();
    const unsafe = 'javascript' + ':alert(1)';
    render(<Tooltip hint="H" moreHref={unsafe} />);
    await user.tab();
    await screen.findByRole('tooltip');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('Escape schliesst die Bubble', async () => {
    const user = userEvent.setup();
    render(<Tooltip hint="H" />);
    await user.tab();
    await screen.findByRole('tooltip');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
