'use strict';

// TDD RED: updateProfile — setzt NUR displayName/phone/theme; role/email/isActive bleiben unverändert.
const { User }                     = require('../../src/domain/User');
const { InMemoryUserRepository }   = require('../../src/repositories/InMemoryUserRepository');

async function makeUser(overrides = {}) {
  const repo = new InMemoryUserRepository();
  const user = new User({
    email: 'test@soc.test',
    displayName: 'Original Name',
    phone: '',
    theme: '',
    role: 'analyst',
    isActive: true,
    passwordHash: '$2b$12$fakehash',
    ...overrides,
  });
  await repo.save(user);
  return { repo, user };
}

describe('InMemoryUserRepository.updateProfile', () => {
  test('updateProfile setzt displayName, phone, theme', async () => {
    const { repo, user } = await makeUser();
    const updated = await repo.updateProfile(user.id, { displayName: 'New Name', phone: '+49 999', theme: 'dark' });
    expect(updated.displayName).toBe('New Name');
    expect(updated.phone).toBe('+49 999');
    expect(updated.theme).toBe('dark');
  });

  test('updateProfile ändert NICHT role', async () => {
    const { repo, user } = await makeUser({ role: 'analyst' });
    await repo.updateProfile(user.id, { displayName: 'X', phone: '', theme: '', role: 'admin' });
    const found = await repo.findById(user.id);
    expect(found.role).toBe('analyst');
  });

  test('updateProfile ändert NICHT email', async () => {
    const { repo, user } = await makeUser({ email: 'orig@soc.test' });
    await repo.updateProfile(user.id, { displayName: 'X', phone: '', theme: '', email: 'hacked@evil.com' });
    const found = await repo.findById(user.id);
    expect(found.email).toBe('orig@soc.test');
  });

  test('updateProfile ändert NICHT isActive', async () => {
    const { repo, user } = await makeUser({ isActive: true });
    await repo.updateProfile(user.id, { displayName: 'X', phone: '', theme: '', isActive: false });
    const found = await repo.findById(user.id);
    expect(found.isActive).toBe(true);
  });

  test('updateProfile ändert NICHT passwordHash', async () => {
    const { repo, user } = await makeUser({ passwordHash: '$2b$12$original' });
    await repo.updateProfile(user.id, { displayName: 'X', phone: '', theme: '', passwordHash: 'hacked' });
    const found = await repo.findById(user.id);
    expect(found.passwordHash).toBe('$2b$12$original');
  });

  test('updateProfile gibt null zurück wenn User nicht gefunden', async () => {
    const repo = new InMemoryUserRepository();
    const result = await repo.updateProfile('nonexistent-id', { displayName: 'X', phone: '', theme: '' });
    expect(result).toBeNull();
  });

  test('partial update: nur displayName', async () => {
    const { repo, user } = await makeUser({ phone: '+49 1', theme: 'light' });
    const updated = await repo.updateProfile(user.id, { displayName: 'Only Name' });
    expect(updated.displayName).toBe('Only Name');
    // phone + theme sollten unverändert bleiben
    expect(updated.phone).toBe('+49 1');
    expect(updated.theme).toBe('light');
  });

  test('updateProfile setzt language + dateFormat', async () => {
    const { repo, user } = await makeUser();
    const updated = await repo.updateProfile(user.id, { language: 'en', dateFormat: 'iso' });
    expect(updated.language).toBe('en');
    expect(updated.dateFormat).toBe('iso');
  });

  test('partial update: language ohne dateFormat lässt dateFormat unverändert', async () => {
    const { repo, user } = await makeUser({ language: 'de', dateFormat: 'iso' });
    const updated = await repo.updateProfile(user.id, { language: 'en' });
    expect(updated.language).toBe('en');
    expect(updated.dateFormat).toBe('iso');
  });
});
