// deployModuleTiles — reine Ableitungs-Logik für den Modul-Katalog des
// Deployment Centers (kein React, kein API). Gut testbar (Projekt-Konvention).
//
// Aufgabe: aus den TATSÄCHLICH vom Backend gelieferten Modulen (Code-Allowlist,
// Quelle der Wahrheit) plus einer statischen „geplant"-Liste eine gruppierte
// Kachel-Sicht ableiten.
//
// Ehrlichkeit ist hart: Ein Produkt gilt genau dann als verfügbar (`available:
// true`), wenn ein Backend-Modul dazu existiert. Alles andere ist `available:
// false` (Badge „Geplant") und darf NICHT in den echten Deploy-Fluss führen.
// Es wird nie ein nicht-implementiertes Produkt als deploybar dargestellt.

import type { DeployModule } from './deployApi';

/** Bekannte Produkt-Kacheln pro Kategorie — matched per `productKey` gegen Backend-Modul-IDs. */
export interface TileCatalogEntry {
  /** Stabiler Produkt-Schlüssel; entspricht der Backend-Modul-ID, wenn implementiert. */
  productKey: string;
  /** Anzeigename der Kachel. */
  label: string;
  /** Hersteller (zweite Zeile der Kachel). */
  vendor: string;
}

/** Eine Kategorie-Gruppe im Katalog (z. B. „Firewalls"). */
export interface TileCategory {
  id: string;
  label: string;
  entries: TileCatalogEntry[];
}

/** Abgeleitete Kachel-Sicht — was die UI rendert. */
export interface ModuleTile {
  productKey: string;
  label: string;
  vendor: string;
  /** true ⇢ echtes Backend-Modul vorhanden, Kachel ist klickbar in den Deploy-Fluss. */
  available: boolean;
  /** Die reale Modul-ID (nur wenn available), mit der der Deploy-Fluss startet. */
  moduleId: string | null;
}

/** Eine gruppierte Kachel-Reihe für die Anzeige. */
export interface GroupedModuleTiles {
  id: string;
  label: string;
  tiles: ModuleTile[];
}

// ─── Statischer Katalog (Struktur; erweiterbar um weitere Kategorien) ─────────
//
// Firewalls: OPNsense ist heute das einzige implementierte Modul (Backend-
// Allowlist). Die übrigen sind bewusst als „Geplant" gelistet — Roadmap, nicht
// Fake-Verfügbarkeit. Weitere Kategorien lassen sich hier einfach ergänzen.
export const TILE_CATALOG: TileCategory[] = [
  {
    id: 'firewalls',
    label: 'Firewalls',
    entries: [
      { productKey: 'opnsense', label: 'OPNsense', vendor: 'Deciso / OPNsense' },
      { productKey: 'pfsense', label: 'pfSense', vendor: 'Netgate' },
      { productKey: 'sophos', label: 'Sophos Firewall', vendor: 'Sophos' },
      { productKey: 'fortinet', label: 'FortiGate', vendor: 'Fortinet' },
      { productKey: 'ipfire', label: 'IPFire', vendor: 'IPFire Project' },
    ],
  },
  {
    // Endpoints/Agenten: agent-install auf bestehende Hosts (Brownfield). Linux-Client
    // (Wazuh-Agent per ssh-systemd) ist heute das einzige implementierte Modul; die
    // übrigen sind bewusst „Geplant".
    id: 'endpoints',
    label: 'Endpoints / Agenten',
    entries: [
      { productKey: 'linux-client', label: 'Linux-Client (Wazuh-Agent)', vendor: 'Wazuh' },
      { productKey: 'windows-client', label: 'Windows-Client (Wazuh-Agent)', vendor: 'Wazuh' },
    ],
  },
  {
    // Kollektoren / Data-Plane (Phase 3): Sammler auf bestehende Hosts (agent-install).
    // Verteilung als Release-Artefakt — Version + SHA256 sind Pflicht, der Installer
    // verifiziert die Prüfsumme vor der Ausführung. Der Firewall-Collector ist das
    // erste implementierte Modul; die übrigen sind bewusst „Geplant".
    id: 'collectors',
    label: 'Kollektoren / Data-Plane',
    entries: [
      { productKey: 'firewall-collector', label: 'Firewall-Collector', vendor: 'Nexora' },
      { productKey: 'ids-sensor', label: 'IDS-Sensor (Suricata)', vendor: 'Nexora' },
      { productKey: 'siem-collector', label: 'SIEM-Collector', vendor: 'Nexora' },
    ],
  },
  {
    // Server (Greenfield, vm-clone): frische Server-VM aus einem Golden-Template
    // klonen — persistent + updatebar. Windows-Server ist heute das erste Modul;
    // Linux-Server folgt analog (cloud-init statt Cloudbase-Init).
    id: 'servers',
    label: 'Server (VM)',
    entries: [
      { productKey: 'rocky-linux-container', label: 'Rocky Linux Container', vendor: 'Rocky Linux / Proxmox LXC' },
      { productKey: 'windows-server', label: 'Windows Server (VM)', vendor: 'Microsoft' },
    ],
  },
];

/**
 * Leitet die gruppierte Kachel-Sicht aus den real verfügbaren Backend-Modulen ab.
 *
 * @param modules  Vom Backend gelieferte Module (Quelle der Wahrheit für Verfügbarkeit).
 * @param catalog  Statischer Kachel-Katalog (Default: TILE_CATALOG).
 * @returns        Gruppen mit Kacheln; `available`/`moduleId` aus echten Modulen abgeleitet.
 */
export function deriveModuleTiles(
  modules: readonly DeployModule[],
  catalog: readonly TileCategory[] = TILE_CATALOG,
): GroupedModuleTiles[] {
  const availableById = new Map<string, DeployModule>();
  for (const m of modules) availableById.set(m.id, m);

  return catalog.map((category) => ({
    id: category.id,
    label: category.label,
    tiles: category.entries.map((entry) => {
      const module = availableById.get(entry.productKey);
      return {
        productKey: entry.productKey,
        // Realer Modulname bevorzugt (bleibt konsistent zum Backend), Katalog-Label als Fallback.
        label: module?.name ?? entry.label,
        vendor: module?.vendor ?? entry.vendor,
        available: Boolean(module),
        moduleId: module ? module.id : null,
      };
    }),
  }));
}

/** Anzahl real verfügbarer Kacheln über alle Gruppen (für Kopfzeilen/KPIs). */
export function countAvailableTiles(groups: readonly GroupedModuleTiles[]): number {
  return groups.reduce((sum, g) => sum + g.tiles.filter((t) => t.available).length, 0);
}
