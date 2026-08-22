import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { hasRole, type Role } from '../lib/rbac';
import { Spinner } from '../components/ui';
import { ForcedPasswordChange } from '../features/auth/ForcedPasswordChange';

export function RequireAuth({ children, min = 'viewer' }: { children: ReactNode; min?: Role }) {
  const { user, loading, refreshUser, logout } = useAuth();

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner label="Sitzung wird geprüft …" /></div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  // Erzwungener Passwortwechsel vor jeglichem geschützten Zugriff —
  // bei Ablauf (Policy) ODER beim ersten Login (Bootstrap-Admin, temporäres Passwort).
  if (user.passwordExpired || user.mustChangePassword) {
    return (
      <ForcedPasswordChange
        email={user.email}
        firstLogin={!user.passwordExpired && !!user.mustChangePassword}
        onDone={refreshUser}
        onLogout={logout}
      />
    );
  }
  if (!hasRole(user.role, min)) {
    return (
      <div style={{ padding: 40, color: 'var(--danger)' }}>
        Kein Zugriff — diese Ansicht erfordert mindestens die Rolle <strong>{min}</strong>.
      </div>
    );
  }
  return <>{children}</>;
}
