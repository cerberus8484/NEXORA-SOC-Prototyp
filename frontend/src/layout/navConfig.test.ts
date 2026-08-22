import { describe, test, expect } from 'vitest';
import {
  NAV_ITEMS, NAV_GROUPS, visibleNavItems, landingItemsForGroup,
  BREADCRUMB, type NavGroup,
} from './navConfig';

const GROUP_KEYS = NAV_GROUPS.map((g) => g.key);

describe('navConfig — Gruppen-Struktur (QW1: system aufgeteilt)', () => {
  test('NAV_GROUPS enthält monitoring + services, kein system/administration mehr', () => {
    expect(GROUP_KEYS).toContain('monitoring');
    expect(GROUP_KEYS).toContain('services');
    expect(GROUP_KEYS).not.toContain('system');
    expect(GROUP_KEYS).not.toContain('administration');
  });

  test('jedes NAV_ITEM verweist auf eine existierende Gruppe (kein Orphan)', () => {
    for (const item of NAV_ITEMS) {
      expect(GROUP_KEYS).toContain(item.group as NavGroup);
    }
  });

  test('keine Gruppe ist überfüllt (max 6 Items je Gruppe)', () => {
    const counts = new Map<string, number>();
    for (const item of NAV_ITEMS) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
    for (const [, n] of counts) expect(n).toBeLessThanOrEqual(6);
  });
});

describe('navConfig — visibleNavItems (QW2: Rollen-Gating)', () => {
  const labels = (role: string | undefined) => visibleNavItems(role).map((i) => i.label);

  test('admin sieht alle Items', () => {
    expect(visibleNavItems('admin')).toHaveLength(NAV_ITEMS.length);
  });

  test('analyst: sieht Audit-Log + Correlators, NICHT ML-Evaluation/Provisioning/Autonomy/SOC-Metriken', () => {
    const l = labels('analyst');
    expect(l).toContain('Audit Log');
    expect(l).toContain('Correlators');
    expect(l).not.toContain('ML Evaluation');
    expect(l).not.toContain('Provisioning');
    expect(l).not.toContain('Autonomy Policies');
    expect(l).not.toContain('SOC Metrics'); // engineer+
  });

  test('engineer: sieht SOC-Metriken, NICHT die admin-only Items', () => {
    const l = labels('engineer');
    expect(l).toContain('SOC Metrics');
    expect(l).not.toContain('Provisioning');
    expect(l).not.toContain('ML Evaluation');
  });

  test('viewer: sieht weder analyst- noch admin-gegatete Items', () => {
    const l = labels('viewer');
    expect(l).toContain('Dashboard');
    expect(l).not.toContain('Audit Log');     // analyst+
    expect(l).not.toContain('Provisioning');  // admin
  });

  test('undefined Rolle: nur ungegatete Items (kein Crash)', () => {
    expect(() => visibleNavItems(undefined)).not.toThrow();
    expect(visibleNavItems(undefined)).toContain(NAV_ITEMS.find((i) => i.label === 'Dashboard'));
  });
});

describe('navConfig — Landing-Pages (Kategorie-Gruppen als anklickbare Seiten)', () => {
  const group = (key: NavGroup) => NAV_GROUPS.find((g) => g.key === key)!;

  test('hunting/detection/integrations/deployment/monitoring/ki haben eine landingTo-Route', () => {
    expect(group('hunting').landingTo).toBe('/hunting');
    expect(group('detection').landingTo).toBe('/detection');
    expect(group('integrations').landingTo).toBe('/integrations');
    expect(group('deployment').landingTo).toBe('/deployment');
    expect(group('monitoring').landingTo).toBe('/monitoring');
    expect(group('ki').landingTo).toBe('/ki');
  });

  test('operations/dashboard/compliance/account/settings/services haben KEINE landingTo-Route', () => {
    expect(group('operations').landingTo).toBeUndefined();
    expect(group('dashboard').landingTo).toBeUndefined();
    expect(group('compliance').landingTo).toBeUndefined();
    expect(group('account').landingTo).toBeUndefined();
    expect(group('settings').landingTo).toBeUndefined();
    expect(group('services').landingTo).toBeUndefined();  // Services = direkter Eintrag
  });

  test('jede Landing-Route hat einen BREADCRUMB-Eintrag', () => {
    for (const g of NAV_GROUPS) {
      if (g.landingTo) expect(BREADCRUMB[g.landingTo]).toBeDefined();
    }
  });

  test('Landing-Pfade kollidieren nicht mit bestehenden Item-Pfaden (/collectors bleibt eigenständig)', () => {
    const itemPaths = new Set(NAV_ITEMS.map((i) => i.to));
    for (const g of NAV_GROUPS) {
      if (g.landingTo) expect(itemPaths.has(g.landingTo)).toBe(false);
    }
    expect(itemPaths.has('/collectors')).toBe(true);
    expect(itemPaths.has('/integrations')).toBe(false);
  });
});

describe('navConfig — Dashboards gehören zu Monitoring, nicht Integrations', () => {
  test('Wazuh Dashboard liegt in der Gruppe monitoring', () => {
    expect(NAV_ITEMS.find((i) => i.to === '/wazuh')!.group).toBe('monitoring');
  });

  test('QRadar Analysis liegt in der Gruppe monitoring', () => {
    expect(NAV_ITEMS.find((i) => i.to === '/qradar')!.group).toBe('monitoring');
  });

  test('Integrations enthält keine Dashboards mehr (kein /wazuh, /qradar)', () => {
    const integ = NAV_ITEMS.filter((i) => i.group === 'integrations').map((i) => i.to);
    expect(integ).not.toContain('/wazuh');
    expect(integ).not.toContain('/qradar');
  });

  test('Wazuh + QRadar erscheinen als Monitoring-Landing-Karten', () => {
    const cards = landingItemsForGroup('monitoring', 'admin').map((c) => c.to);
    expect(cards).toContain('/wazuh');
    expect(cards).toContain('/qradar');
  });
});

describe('navConfig — Integrations-Konfiguration als eigene Integrations-Sub-Page', () => {
  const configItem = () => NAV_ITEMS.find((i) => i.to === '/integrations/config');

  test('liegt in der Gruppe integrations und ist admin-only', () => {
    const item = configItem();
    expect(item).toBeDefined();
    expect(item!.group).toBe('integrations');
    expect(item!.minRole).toBe('admin');
  });

  test('hat einen BREADCRUMB-Eintrag (spezifischer als /integrations)', () => {
    expect(BREADCRUMB['/integrations/config']).toBeDefined();
  });

  test('erscheint als admin-Landing-Karte unter integrations, nicht für analyst', () => {
    const adminCards = landingItemsForGroup('integrations', 'admin').map((c) => c.to);
    const analystCards = landingItemsForGroup('integrations', 'analyst').map((c) => c.to);
    expect(adminCards).toContain('/integrations/config');
    expect(analystCards).not.toContain('/integrations/config');
  });
});

describe('navConfig — KI / Automation als eigene Gruppe (aus Administration gelöst)', () => {
  test('KI-Gruppe existiert mit Landing /ki', () => {
    expect(GROUP_KEYS).toContain('ki');
    expect(NAV_GROUPS.find((g) => g.key === 'ki')!.landingTo).toBe('/ki');
    expect(BREADCRUMB['/ki']).toBeDefined();
  });

  test('KI Agent, Autonomy Policies, ML-Evaluation liegen in der ki-Gruppe', () => {
    const ki = NAV_ITEMS.filter((i) => i.group === 'ki').map((i) => i.to);
    expect(ki).toEqual(expect.arrayContaining(['/ki-agent', '/autonomy-policies', '/ml-eval']));
  });

  test('Administration-Gruppe ist aufgelöst — es gibt keine mehr', () => {
    expect(GROUP_KEYS).not.toContain('administration');
    expect(NAV_ITEMS.some((i) => (i.group as string) === 'administration')).toBe(false);
  });

  test('KI-Karten erscheinen auf der /ki-Landing (admin: alle 3, analyst: nur KI Agent)', () => {
    const adminCards = landingItemsForGroup('ki', 'admin').map((c) => c.to);
    const analystCards = landingItemsForGroup('ki', 'analyst').map((c) => c.to);
    expect(adminCards).toEqual(expect.arrayContaining(['/ki-agent', '/autonomy-policies', '/ml-eval']));
    expect(analystCards).toContain('/ki-agent');        // ungegated
    expect(analystCards).not.toContain('/ml-eval');     // admin-only
  });
});

describe('navConfig — Deployment / Nodes als eigene Gruppe (Deploy+Provisioning+Correlators+Data-Plane)', () => {
  test('Deployment-Gruppe existiert mit Landing /deployment', () => {
    expect(GROUP_KEYS).toContain('deployment');
    expect(NAV_GROUPS.find((g) => g.key === 'deployment')!.landingTo).toBe('/deployment');
    expect(BREADCRUMB['/deployment']).toBeDefined();
  });

  test('Deploy, Provisioning, Correlators, Data-Plane liegen in der deployment-Gruppe', () => {
    const dep = NAV_ITEMS.filter((i) => i.group === 'deployment').map((i) => i.to);
    expect(dep).toEqual(expect.arrayContaining(['/deploy', '/provisioning', '/correlators', '/dataplane']));
  });

  test('Integrations enthält kein /deploy und /dataplane mehr (nur Collectors + Konfiguration)', () => {
    const integ = NAV_ITEMS.filter((i) => i.group === 'integrations').map((i) => i.to);
    expect(integ).toEqual(['/collectors', '/integrations/config']);
  });

  test('/deployment-Breadcrumb steht vor /deploy (Präfix-Kollision)', () => {
    const keys = Object.keys(BREADCRUMB);
    expect(keys.indexOf('/deployment')).toBeLessThan(keys.indexOf('/deploy'));
  });
});

describe('navConfig — Services (admin-only, eigener Top-Level-Eintrag)', () => {
  const servicesItem = () => NAV_ITEMS.find((i) => i.to === '/services');

  test('Services gehört zur Gruppe services (direkter Eintrag, kein Landing) und ist admin-only', () => {
    const item = servicesItem();
    expect(item).toBeDefined();
    expect(item!.group).toBe('services');
    expect(item!.minRole).toBe('admin');
    expect(NAV_GROUPS.find((g) => g.key === 'services')!.landingTo).toBeUndefined();
  });

  test('Services hat einen BREADCRUMB-Eintrag', () => {
    expect(BREADCRUMB['/services']).toBeDefined();
  });

  test('Services ist nur für Admins sichtbar (nicht für analyst)', () => {
    expect(visibleNavItems('admin').map((i) => i.to)).toContain('/services');
    expect(visibleNavItems('analyst').map((i) => i.to)).not.toContain('/services');
  });
});

describe('navConfig — Settings als eigenständiger Top-Level-Eintrag', () => {
  test('settings ist eine eigene Gruppe, nicht mehr unter administration', () => {
    expect(GROUP_KEYS).toContain('settings');
    const settingsItem = NAV_ITEMS.find((i) => i.to === '/settings')!;
    expect(settingsItem.group).toBe('settings');
    expect(settingsItem.group).not.toBe('administration');
  });

  test('settings-Gruppe hat keine landingTo (rendert als einzelner Eintrag)', () => {
    expect(NAV_GROUPS.find((g) => g.key === 'settings')!.landingTo).toBeUndefined();
  });
});

describe('navConfig — landingItemsForGroup (pure Card-Daten-Ableitung)', () => {
  test('liefert rollengefilterte Items der Gruppe mit Label, Pfad und Beschreibung aus BREADCRUMB', () => {
    const cards = landingItemsForGroup('hunting', 'admin');
    expect(cards.map((c) => c.to)).toEqual(['/threat-hunts', '/hunt-library', '/hunting/settings']);
    const console = cards.find((c) => c.to === '/threat-hunts')!;
    expect(console.label).toBe('Threat Hunts');
    expect(console.description).toBe('Hunt Console'); // zweites BREADCRUMB-Tupel-Element
  });

  test('respektiert das Rollen-Gating der Gruppe (analyst sieht keine admin-only Items)', () => {
    // provisioning/correlators liegen jetzt in der deployment-Gruppe.
    const adminCards = landingItemsForGroup('deployment', 'admin').map((c) => c.to);
    const analystCards = landingItemsForGroup('deployment', 'analyst').map((c) => c.to);
    expect(adminCards).toContain('/provisioning');   // admin-only
    expect(analystCards).not.toContain('/provisioning');
    expect(analystCards).toContain('/correlators');  // analyst+
  });

  test('schließt den Landing-Eintrag selbst nicht als Karte ein (keine Selbst-Referenz)', () => {
    const cards = landingItemsForGroup('integrations', 'admin');
    expect(cards.map((c) => c.to)).not.toContain('/integrations');
    expect(cards.map((c) => c.to)).toContain('/collectors');
  });

  test('Gruppe ohne Items liefert leeres Array (kein Crash)', () => {
    expect(() => landingItemsForGroup('hunting', undefined)).not.toThrow();
  });
});
