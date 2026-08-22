import { describe, expect, test } from 'vitest';
import {
  isInternalUrl, buildQdrantPatch, qdrantConnError, qdrantSourceLabel,
  type QdrantMasked, type QdrantForm,
} from './qdrantConnectionModel';

const masked = (o: Partial<QdrantMasked> = {}): QdrantMasked => ({ url: 'http://10.0.10.40:6333', apiKeySet: true, source: 'db', ...o });
const form = (o: Partial<QdrantForm> = {}): QdrantForm => ({ url: '', apiKey: '', ...o });

describe('isInternalUrl', () => {
  test('localhost + RFC-1918 ok, extern nicht', () => {
    expect(isInternalUrl('http://127.0.0.1:6333')).toBe(true);
    expect(isInternalUrl('http://10.0.10.40:6333')).toBe(true);
    expect(isInternalUrl('https://evil.example.com')).toBe(false);
    expect(isInternalUrl('')).toBe(false);
  });
});

describe('buildQdrantPatch', () => {
  test('getrimmt; leerer Key bleibt leer (Server behält / optional)', () => {
    expect(buildQdrantPatch(form({ url: ' http://10.0.10.41:6333 ', apiKey: '' }))).toEqual({ url: 'http://10.0.10.41:6333', apiKey: '' });
  });
  test('URL geleert bei DB-Quelle → Lösch-Patch', () => {
    expect(buildQdrantPatch(form(), masked({ source: 'db' }))).toEqual({ url: '', apiKey: '' });
  });
  test('leeres Formular bei env-Quelle → null', () => {
    expect(buildQdrantPatch(form(), masked({ source: 'env' }))).toBeNull();
  });
});

describe('qdrantConnError', () => {
  test('leere URL → kein Fehler', () => {
    expect(qdrantConnError(form(), masked({ source: 'none' }))).toBe('');
  });
  test('externe URL → Fehler', () => {
    expect(qdrantConnError(form({ url: 'https://evil.example.com' }), masked({ source: 'none' }))).toMatch(/intern/i);
  });
  test('interne URL ohne Key → kein Fehler (Key optional)', () => {
    expect(qdrantConnError(form({ url: 'http://10.0.10.41:6333' }), masked({ source: 'none', apiKeySet: false, url: '' }))).toBe('');
  });
});

describe('qdrantSourceLabel', () => {
  test('ehrlich', () => {
    expect(qdrantSourceLabel('db')).toMatch(/UI/);
    expect(qdrantSourceLabel('env')).toMatch(/Systemwert/);
    expect(qdrantSourceLabel('none')).toMatch(/[Nn]icht/);
  });
});
