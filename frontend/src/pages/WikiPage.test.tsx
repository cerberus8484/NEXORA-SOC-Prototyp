import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { WikiPage } from './WikiPage';

describe('WikiPage', () => {
  it('zeigt auf /wiki die interne Startseite statt eines iFrames', () => {
    render(
      <MemoryRouter initialEntries={['/wiki']}>
        <WikiPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Bedienung für Menschen, nicht für Maschinen/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Erste Schritte in Nexora/i).length).toBeGreaterThan(0);
    expect(screen.queryByTitle(/Wiki -/i)).not.toBeInTheDocument();
  });

  it('rendert einen nativen Artikel für bekannte Themen', () => {
    render(
      <MemoryRouter initialEntries={['/wiki/admin/integrationen']}>
        <WikiPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/Integrationen einrichten/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/So richtest du eine Quelle sauber ein/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Verbindung testen/i).length).toBeGreaterThan(0);
  });

  it('zeigt im Deployment-Wiki ein ausgefülltes Formularbeispiel mit Dummy-Daten', () => {
    render(
      <MemoryRouter initialEntries={['/wiki/bedienung/deployment-center']}>
        <WikiPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Lab-Proxmox-Nord/i)).toBeInTheDocument();
    expect(screen.getByText(/10\.0\.10\.20/i)).toBeInTheDocument();
    expect(screen.getByText(/^pve$/i)).toBeInTheDocument();
    expect(screen.getByText(/\+ Connector anlegen/i)).toBeInTheDocument();
  });
});
