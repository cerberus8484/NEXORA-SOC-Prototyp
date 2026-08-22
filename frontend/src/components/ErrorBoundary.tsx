import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Fängt Render-Fehler in untergeordneten Komponenten ab, damit ein einzelner
 * Fehler nicht den gesamten React-Tree (weißer Bildschirm) reißt.
 * Class Component, da React noch keine funktionale Error-Boundary kennt.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Letzte Instanz für sonst unsichtbare Render-Fehler — bewusst console.error,
    // kein externes Tracking. Den Fehler hier zu verschlucken wäre schlimmer als das Log.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 24 }}>
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--danger, #ff5c5c)',
          borderRadius: 'var(--radius, 12px)', padding: 28, maxWidth: 480, textAlign: 'center',
          boxShadow: 'var(--shadow-pop, 0 8px 30px rgba(0,0,0,0.4))',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Unerwarteter Fehler</div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 18px', lineHeight: 1.5 }}>
            Beim Anzeigen dieser Seite ist ein Fehler aufgetreten. Die übrige Anwendung läuft weiter.
          </p>
          {this.state.message && (
            <pre style={{
              fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-input, rgba(0,0,0,0.25))',
              borderRadius: 8, padding: '8px 10px', overflowX: 'auto', textAlign: 'left', margin: '0 0 18px',
            }}>{this.state.message}</pre>
          )}
          <button type="button" onClick={() => window.location.reload()} style={{
            background: 'var(--accent, #00d4ff)', color: '#06121b', border: 'none',
            borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 13,
          }}>Seite neu laden</button>
        </div>
      </div>
    );
  }
}
