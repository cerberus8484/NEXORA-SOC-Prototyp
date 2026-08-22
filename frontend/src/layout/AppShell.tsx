import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { HeaderSlotProvider } from '../app/HeaderSlot';
import { KeyboardShortcuts } from '../features/shortcuts/KeyboardShortcuts';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const toggleSidebar = () => setCollapsed((c) => !c);

  return (
    <div className="app-shell">
      {/* Globale Tastatur-Shortcuts (Navigation, ?-Hilfe, Sidebar-Toggle) */}
      <KeyboardShortcuts onToggleSidebar={toggleSidebar} />
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      {/* HeaderSlotProvider umschließt Topbar UND Outlet: eine Seite kann einen Inhalt
          (z. B. den Analysis-Ticket-Switcher) in die globale Topbar einklinken. */}
      <HeaderSlotProvider>
        <div className="app-main">
          <Topbar onMenu={toggleSidebar} />
          <main className="app-content">
            {/* key=pathname → Boundary setzt sich nach Navigation automatisch zurück */}
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </main>
          <Footer />
        </div>
      </HeaderSlotProvider>
    </div>
  );
}
