'use strict';

const { UseCase } = require('../src/domain/UseCase');

describe('UseCase (Domain)', () => {
  test('erzeugt ID + Zeitstempel automatisch', () => {
    const uc = new UseCase({ value: 'UC-042 – Lateral Movement' });
    expect(uc.id).toMatch(/[0-9a-f-]{36}/);
    expect(uc.createdAt).toBeTruthy();
  });

  test('trimmt den Wert und kappt überlange Werte', () => {
    const uc = new UseCase({ value: '  ' + 'x'.repeat(500) + '  ' });
    expect(uc.value.length).toBeLessThanOrEqual(200);
    expect(uc.value.startsWith('x')).toBe(true);
  });

  test('übernimmt author', () => {
    const uc = new UseCase({ value: 'X', author: 'a@nexora' });
    expect(uc.author).toBe('a@nexora');
  });

  test('isValid() true nur mit Wert', () => {
    expect(new UseCase({ value: 'X' }).isValid()).toBe(true);
    expect(new UseCase({ value: '   ' }).isValid()).toBe(false);
    expect(new UseCase({}).isValid()).toBe(false);
  });

  test('toJSON enthält id, value, author, createdAt', () => {
    const uc = new UseCase({ value: 'X', author: 'a' });
    expect(uc.toJSON()).toMatchObject({ value: 'X', author: 'a' });
    expect(uc.toJSON().id).toBe(uc.id);
  });
});
