import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExampleHint } from './ExampleHint';

describe('ExampleHint', () => {
  it('renders a filled mini preview with example values', () => {
    render(
      <ExampleHint
        title="Wofuer das Feld steht"
        text="Kurze Erklaerung."
        exampleLabel="Beispiel"
        rows={[
          { label: 'Host', value: '10.0.10.20' },
          { label: 'Node', value: 'pve' },
        ]}
        footer="Wichtiger Hinweis."
      />,
    );

    expect(screen.getByText(/Wofuer das Feld steht/i)).toBeInTheDocument();
    expect(screen.getByText('10.0.10.20')).toBeInTheDocument();
    expect(screen.getByText('pve')).toBeInTheDocument();
    expect(screen.getByText(/Wichtiger Hinweis/i)).toBeInTheDocument();
  });
});
