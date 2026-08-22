import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/auth', () => ({ useAuth: vi.fn() }));
import { useAuth } from '../lib/auth';
import { RequireAuth } from './RequireAuth';

const mockedUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function setup(user: Record<string, unknown> | null) {
  mockedUseAuth.mockReturnValue({ user, loading: false, refreshUser: vi.fn(), logout: vi.fn() });
  return render(
    <MemoryRouter>
      <RequireAuth><div>GESCHUETZT</div></RequireAuth>
    </MemoryRouter>,
  );
}

describe('RequireAuth — Forced-Password-Gate', () => {
  it('blockt geschützte Kinder + zeigt Erstanmeldung-Gate bei mustChangePassword', () => {
    setup({ email: 'a@b.c', role: 'admin', mustChangePassword: true });
    expect(screen.getByText(/Erstanmeldung — Passwort festlegen/)).toBeInTheDocument();
    expect(screen.queryByText('GESCHUETZT')).not.toBeInTheDocument();
  });

  it('blockt auch bei passwordExpired', () => {
    setup({ email: 'a@b.c', role: 'admin', passwordExpired: true });
    expect(screen.queryByText('GESCHUETZT')).not.toBeInTheDocument();
  });

  it('lässt geschützte Kinder durch, wenn kein Wechsel nötig', () => {
    setup({ email: 'a@b.c', role: 'admin' });
    expect(screen.getByText('GESCHUETZT')).toBeInTheDocument();
  });
});
