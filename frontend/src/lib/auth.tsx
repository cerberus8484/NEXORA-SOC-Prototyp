import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './apiClient';
import { authApi } from '../features/auth/authApi';
import { normalizeMfaCode } from '../features/auth/loginChallengeModel';
import { shouldClearAuthOnRefreshError } from './authRefreshModel';
import { useTranslation } from 'react-i18next';

export interface User {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  /** true, wenn das Passwort gemäß Ablauf-Policy gewechselt werden muss. */
  passwordExpired?: boolean;
  /** true, wenn das Passwort beim ERSTEN Login gewechselt werden muss (Bootstrap-Admin). */
  mustChangePassword?: boolean;
}

/**
 * Ergebnis des Passwort-Schritts: entweder direkt eingeloggt (kein MFA) oder
 * eine offene MFA-Challenge, die der Aufrufer mit completeMfaChallenge abschließt.
 * Discriminated Union über `mfaRequired`.
 */
export type LoginResult =
  | { mfaRequired: false; mfaSetupRequired: false }
  | { mfaRequired: true;  mfaSetupRequired: false; challengeToken: string }
  | { mfaRequired: false; mfaSetupRequired: true;  setupToken: string };

interface AuthState {
  user: User | null;
  loading: boolean;
  /**
   * Passwort-Schritt. Bei aktivem MFA ODER org-weiter MFA-Pflicht wird NICHT
   * eingeloggt (kein setUser); das Ergebnis signalisiert Challenge bzw. Setup.
   */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Schließt eine offene MFA-Challenge ab (2. Faktor) und etabliert die Session. */
  completeMfaChallenge: (challengeToken: string, code: string) => Promise<void>;
  /** Schließt erzwungenes MFA-Setup ab → Session + Recovery-Codes (einmalig). */
  completeMfaSetup: (setupToken: string, code: string) => Promise<string[]>;
  logout: () => Promise<void>;
  /** Lädt /auth/me neu (z.B. nach erzwungenem Passwortwechsel). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** Antwort von POST /auth/login: entweder direkter Login oder MFA-Challenge. */
type LoginResponse =
  | { token?: string; user: User; mfaRequired?: false; mfaSetupRequired?: false }
  | { mfaRequired: true; challengeToken: string }
  | { mfaSetupRequired: true; setupToken: string };
interface MeResponse { data: User; }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Beim Start: Session über das httpOnly-Cookie validieren via /auth/me.
  // Kein Token-Gate mehr — das Cookie wird automatisch mitgesendet; 401 = nicht angemeldet.
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const res = await api.get<MeResponse>('/auth/me');
        if (active) setUser(res.data);
      } catch (err) {
        // Symmetrisch zu refreshUser: nur ein echtes 401 bedeutet „nicht angemeldet".
        // Ein Netz-/Server-Fehler beim Start darf einen (künftig) gültigen Zustand nicht
        // aktiv als ausgeloggt zementieren — User-State bleibt dann unangetastet.
        if (active && shouldClearAuthOnRefreshError(err)) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    void restore();
    return () => { active = false; };
  }, []);

  async function login(email: string, password: string): Promise<LoginResult> {
    // Token + CSRF-Cookie werden serverseitig gesetzt; wir behalten kein Token im JS.
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    // MFA aktiv: KEIN Session-Cookie, KEIN Login — Aufrufer muss 2. Faktor liefern.
    if ('mfaRequired' in res && res.mfaRequired) {
      return { mfaRequired: true, mfaSetupRequired: false, challengeToken: res.challengeToken };
    }
    // Org-weite MFA-Pflicht: User muss erst MFA einrichten (kein Login bis abgeschlossen).
    if ('mfaSetupRequired' in res && res.mfaSetupRequired) {
      return { mfaRequired: false, mfaSetupRequired: true, setupToken: res.setupToken };
    }
    setUser(res.user);
    return { mfaRequired: false, mfaSetupRequired: false };
  }

  async function completeMfaChallenge(challengeToken: string, code: string): Promise<void> {
    // Code hier normalisieren (Whitespace/Bindestriche, Groß-/Kleinschreibung),
    // damit formatierte Recovery-Codes serverseitig matchen — zentral für alle Aufrufer.
    // Erst /auth/mfa etabliert die Session (httpOnly-Cookie serverseitig gesetzt).
    const res = await authApi.verifyMfa(challengeToken, normalizeMfaCode(code));
    setUser(res.user);
  }

  async function completeMfaSetup(setupToken: string, code: string): Promise<string[]> {
    // Erzwungenes Enrollment abschließen: /auth/mfa-setup/complete aktiviert MFA und
    // etabliert die Session (httpOnly-Cookie). Recovery-Codes werden EINMALIG gezeigt.
    const res = await authApi.completeMfaSetup(setupToken, normalizeMfaCode(code));
    setUser(res.user);
    return res.recoveryCodes;
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch { /* best effort */ }
    setUser(null);
  }

  async function refreshUser() {
    try {
      const res = await api.get<MeResponse>('/auth/me');
      setUser(res.data);
    } catch (err) {
      // „leer" ≠ „Fehler": NUR ein echtes 401 (Session weg) loggt aus. Netz-/
      // Server-Fehler dürfen den eingeloggten User nicht verwerfen (stale-Auth-Bug).
      if (shouldClearAuthOnRefreshError(err)) setUser(null);
      // sonst: User-State bleibt unangetastet, der nächste Refresh versucht es erneut.
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, completeMfaChallenge, completeMfaSetup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const { t: tr } = useTranslation();
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error(tr('app.useauthMustUsedInsideAuthprovider'));
  return ctx;
}
