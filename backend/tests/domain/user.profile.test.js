'use strict';

// TDD RED: User-Domain — phone/theme round-trips, toPublicJSON enthält sie, kein Hash.
const { User } = require('../../src/domain/User');

describe('User Domain — phone/theme', () => {
  test('Konstruktor-Defaults: phone="" und theme=""', () => {
    const u = new User({ email: 'a@test.soc' });
    expect(u.phone).toBe('');
    expect(u.theme).toBe('');
  });

  test('Werte werden aus Konstruktor übernommen', () => {
    const u = new User({ email: 'a@test.soc', phone: '+49 123 456', theme: 'dark' });
    expect(u.phone).toBe('+49 123 456');
    expect(u.theme).toBe('dark');
  });

  test('toPublicJSON gibt phone + theme mit aus', () => {
    const u = new User({ email: 'a@test.soc', phone: '+49 9', theme: 'light' });
    const pub = u.toPublicJSON();
    expect(pub.phone).toBe('+49 9');
    expect(pub.theme).toBe('light');
  });

  test('toPublicJSON enthält NIEMALS passwordHash', () => {
    const u = new User({ email: 'a@test.soc', passwordHash: '$2b$12$secret', phone: '', theme: '' });
    const pub = u.toPublicJSON();
    expect(pub.passwordHash).toBeUndefined();
  });

  test('JSON.stringify gibt keinen passwordHash raus', () => {
    const u = new User({ email: 'a@test.soc', passwordHash: '$2b$12$secret', phone: '', theme: '' });
    const parsed = JSON.parse(JSON.stringify(u));
    expect(parsed.passwordHash).toBeUndefined();
  });

  test('toPublicJSON enthält displayName', () => {
    const u = new User({ email: 'a@test.soc', displayName: 'Alice', phone: '+49', theme: 'dark' });
    const pub = u.toPublicJSON();
    expect(pub.displayName).toBe('Alice');
    expect(pub.phone).toBe('+49');
    expect(pub.theme).toBe('dark');
  });
});

describe('User Domain — language/dateFormat', () => {
  test('Konstruktor-Defaults: language="en" und dateFormat="dmy"', () => {
    const u = new User({ email: 'a@test.soc' });
    expect(u.language).toBe('en');
    expect(u.dateFormat).toBe('dmy');
  });

  test('Werte werden aus Konstruktor übernommen', () => {
    const u = new User({ email: 'a@test.soc', language: 'en', dateFormat: 'iso' });
    expect(u.language).toBe('en');
    expect(u.dateFormat).toBe('iso');
  });

  test('toPublicJSON gibt language + dateFormat mit aus', () => {
    const u = new User({ email: 'a@test.soc', language: 'en', dateFormat: 'iso' });
    const pub = u.toPublicJSON();
    expect(pub.language).toBe('en');
    expect(pub.dateFormat).toBe('iso');
  });
});
