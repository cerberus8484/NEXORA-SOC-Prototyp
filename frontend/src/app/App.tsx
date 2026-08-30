import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth';
import { AppRouter } from './router';
import { getPlatform } from '../features/settings/settingsApi';
import { applyBranding } from '../features/settings/applyBranding';
import { useIdleLogout } from '../hooks/useIdleLogout';
import { LanguageProvider } from '../i18n/LanguageProvider';
import '../i18n';

/**
 * Inaktivitäts-Timeout: lädt die Plattform-Einstellung sobald ein Nutzer
 * angemeldet ist und meldet bei Inaktivität automatisch ab. 0 = deaktiviert.
 */
function IdleGuard() {
  const { user, logout } = useAuth();
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    if (!user) { setMinutes(0); return; }
    let alive = true;
    getPlatform()
      .then((p) => {
        if (!alive) return;
        setMinutes(p.inactivityTimeoutMinutes ?? 0);
        // Branding app-weit anwenden (Akzent/Hintergrund/Sidebar-Farbe/Schriftart) —
        // wirkt auf allen Seiten, nicht nur im offenen Branding-Tab.
        applyBranding(p);
      })
      .catch(() => { /* Einstellung nicht ladbar → Timeout aus, Branding bleibt Default */ });
    return () => { alive = false; };
  }, [user]);

  const onIdle = useCallback(() => { void logout(); }, [logout]);
  useIdleLogout(user ? minutes : 0, onIdle);

  return null;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <IdleGuard />
        <LanguageProvider />
        <AppRouter />
      </BrowserRouter>
    </AuthProvider>
  );
}
