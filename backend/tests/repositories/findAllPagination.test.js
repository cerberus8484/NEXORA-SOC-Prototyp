'use strict';

// Audit-Fix (HIGH): findAll() war unbegrenzt. Jetzt opt-in { limit, offset }
// mit Default-Cap (abwärtskompatibel: ohne Args → Array wie bisher, gecappt).
// Stellvertretend gegen InMemoryUserRepository getestet — Postgres spiegelt
// dieselbe Semantik via LIMIT/OFFSET.
const { User }                   = require('../../src/domain/User');
const { InMemoryUserRepository } = require('../../src/repositories/InMemoryUserRepository');

async function seed(n) {
  const repo = new InMemoryUserRepository();
  for (let i = 0; i < n; i++) {
    await repo.save(new User({
      email: `u${String(i).padStart(2, '0')}@soc.test`,
      displayName: `U${i}`,
      phone: '',
      theme: '',
      role: 'analyst',
      isActive: true,
      passwordHash: '$2b$12$fakehash',
    }));
  }
  return repo;
}

describe('InMemoryUserRepository.findAll — limit/offset (Default-Cap)', () => {
  test('ohne Args: liefert alle (kleine Menge unter dem Default-Cap)', async () => {
    const repo = await seed(5);
    expect(await repo.findAll()).toHaveLength(5);
  });

  test('limit begrenzt die Ergebnismenge', async () => {
    const repo = await seed(5);
    expect(await repo.findAll({ limit: 2 })).toHaveLength(2);
  });

  test('offset überspringt Einträge (sortiert nach email ASC)', async () => {
    const repo = await seed(5);
    const all = await repo.findAll();
    const skipped = await repo.findAll({ offset: 2 });
    expect(skipped).toHaveLength(3);
    expect(skipped[0].email).toBe(all[2].email);
  });

  test('limit + offset kombiniert (Seite 2)', async () => {
    const repo = await seed(5);
    expect(await repo.findAll({ limit: 2, offset: 2 })).toHaveLength(2);
  });
});
