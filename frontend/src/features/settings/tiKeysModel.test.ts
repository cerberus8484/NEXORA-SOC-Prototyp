import { describe, expect, test } from 'vitest';
import {
  TI_PROVIDER_META,
  tiSourceLabel,
  buildTiSavePatch,
  hasTiChanges,
  type TiKeyForm,
} from './tiKeysModel';

describe('TI_PROVIDER_META', () => {
  test('deckt virustotal + abuseipdb mit Labels ab', () => {
    expect(TI_PROVIDER_META.map((m) => m.provider).sort()).toEqual(['abuseipdb', 'virustotal']);
    expect(TI_PROVIDER_META.every((m) => m.label && m.docsHint)).toBe(true);
  });
});

describe('tiSourceLabel', () => {
  test('ehrliche Herkunfts-Labels', () => {
    expect(tiSourceLabel('db')).toMatch(/UI/);
    expect(tiSourceLabel('env')).toMatch(/Systemwert/);
    expect(tiSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});

describe('buildTiSavePatch', () => {
  const form = (p: Partial<TiKeyForm> = {}): TiKeyForm => ({ virustotal: '', abuseipdb: '', ...p });

  test('nur nicht-leere, getrimmte Felder landen im Patch', () => {
    expect(buildTiSavePatch(form({ virustotal: '  vt-key ', abuseipdb: '' })))
      .toEqual({ virustotal: 'vt-key' });
  });

  test('beide gesetzt → beide im Patch', () => {
    expect(buildTiSavePatch(form({ virustotal: 'a', abuseipdb: 'b' })))
      .toEqual({ virustotal: 'a', abuseipdb: 'b' });
  });

  test('leeres Formular → leerer Patch', () => {
    expect(buildTiSavePatch(form())).toEqual({});
  });
});

describe('hasTiChanges', () => {
  test('true nur, wenn mindestens ein Feld nicht-leer ist', () => {
    expect(hasTiChanges({ virustotal: '', abuseipdb: '' })).toBe(false);
    expect(hasTiChanges({ virustotal: '  ', abuseipdb: '' })).toBe(false);
    expect(hasTiChanges({ virustotal: 'x', abuseipdb: '' })).toBe(true);
  });
});
