import { describe, test, expect } from 'vitest';
import { isValidRole, canDeactivate, canChangeRoleTo, type ManagedUser } from './userMgmtModel';

const target: ManagedUser = { id: 'u2', email: 'b@test.soc', role: 'viewer', isActive: true };
const self:   ManagedUser = { id: 'u1', email: 'a@test.soc', role: 'admin',  isActive: true };

describe('isValidRole', () => {
  test('erkennt gültige Rollen', () => {
    expect(isValidRole('analyst')).toBe(true);
    expect(isValidRole('superuser')).toBe(false);
  });
});

describe('canDeactivate', () => {
  test('fremden User ja, sich selbst nein', () => {
    expect(canDeactivate('u1', target)).toBe(true);
    expect(canDeactivate('u1', self)).toBe(false);
  });
});

describe('canChangeRoleTo', () => {
  test('fremden User auf gültige Rolle', () => {
    expect(canChangeRoleTo('u1', target, 'analyst')).toBe(true);
  });

  test('ungültige Rolle wird abgelehnt', () => {
    expect(canChangeRoleTo('u1', target, 'root')).toBe(false);
  });

  test('Selbst-Degradierung weg von admin wird abgelehnt', () => {
    expect(canChangeRoleTo('u1', self, 'analyst')).toBe(false);
    expect(canChangeRoleTo('u1', self, 'admin')).toBe(true);
  });
});
