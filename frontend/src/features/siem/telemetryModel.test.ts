import { describe, expect, test } from 'vitest';
import { niceMax, seriesTotal, lastValue, bucketTimeLabel, sumSeries } from './telemetryModel';
import { ZONES, zoneSeries } from './topology';
import type { TelemetryPoint } from './siemApi';

const pts = (...counts: number[]): TelemetryPoint[] =>
  counts.map((count, i) => ({ t: `2026-06-11T0${i}:00:00Z`, count }));

describe('telemetryModel', () => {
  test('niceMax rundet auf eine lesbare Achsen-Obergrenze auf', () => {
    expect(niceMax(0)).toBe(10);     // leere Serie → sinnvolle Default-Skala
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(99)).toBe(100);
    expect(niceMax(1400)).toBe(1500);
  });

  test('seriesTotal summiert alle Buckets', () => {
    expect(seriesTotal(pts(5, 10, 3))).toBe(18);
    expect(seriesTotal([])).toBe(0);
  });

  test('lastValue liefert den jüngsten Bucket (0 bei leer)', () => {
    expect(lastValue(pts(5, 10, 3))).toBe(3);
    expect(lastValue([])).toBe(0);
  });

  test('bucketTimeLabel formatiert ISO-Zeit als HH:MM', () => {
    const label = bucketTimeLabel('2026-06-11T08:15:00Z');
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });

  test('bucketTimeLabel bei ungültiger Zeit → leerer String statt "Invalid Date"', () => {
    expect(bucketTimeLabel('kaputt')).toBe('');
  });

  test('sumSeries summiert punktweise; kürzere Serien zählen 0', () => {
    expect(sumSeries([pts(1, 2, 3), pts(10, 20)])).toEqual([
      { t: '2026-06-11T00:00:00Z', count: 11 },
      { t: '2026-06-11T01:00:00Z', count: 22 },
      { t: '2026-06-11T02:00:00Z', count: 3 },
    ]);
    expect(sumSeries([])).toEqual([]);
    expect(sumSeries([[], []])).toEqual([]);
  });
});

describe('topology', () => {
  const agents = [
    { name: 'WEC01', points: pts(5, 7) },
    { name: 'wazuh-server', points: pts(1, 1) },
    { name: 'WindowsClient', points: pts(9, 9) },
  ];

  test('zoneSeries summiert nur die Agents der Zone', () => {
    const vlan10 = ZONES.find((z) => z.key === 'vlan10')!;
    expect(zoneSeries(vlan10, agents).map((p) => p.count)).toEqual([6, 8]);
  });

  test('zoneSeries ohne liefernde Agents → leer (ehrlich, kein Fake)', () => {
    const vlan30 = ZONES.find((z) => z.key === 'vlan30')!;
    expect(zoneSeries(vlan30, agents)).toEqual([]);
  });
});
