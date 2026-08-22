// Zentraler API-Client für /api/v1/* — fetch-Wrapper mit Token + Fehler-Mapping.

const BASE = (import.meta.env?.VITE_API_BASE as string | undefined) || "/api/v1";

// Öffentliche Basis für direkte Browser-Navigationen (z.B. SSO-Redirect-Flow),
// die NICHT über fetch laufen. Einzige Quelle für den /api/v1-Präfix.
export const API_BASE = BASE;

// Auth-Modell: Cookie-only. Das Backend setzt ein httpOnly soc_token-Cookie
// (sameSite=strict); der Browser sendet es via credentials:'include' automatisch
// mit. Es liegt KEIN Token mehr im sessionStorage → XSS kann ihn nicht stehlen.
// CSRF-Schutz: Double-Submit — das (JS-lesbare) csrf_token-Cookie wird bei
// state-changing Requests als X-CSRF-Token-Header zurückgeschickt; der Server
// vergleicht beide. sameSite=strict am Auth-Cookie ist die erste Verteidigungslinie.
function getCsrfToken(): string | null {
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("csrf_token="));
  return match ? decodeURIComponent(match.slice("csrf_token=".length)) : null;
}

export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  /** Strukturierte Fehlerdetails aus dem Antwort-Body (z.B. Validierungs-/Guardrail-Gründe).
   *  Wird gefüllt, wenn das Backend ein `errors`-Array liefert — sonst leer. So geht die
   *  eigentliche Begründung (statt „HTTP 422") nicht verloren. */
  errors?: string[];
  constructor(message: string, status: number, code = "ERROR", requestId?: string, errors?: string[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.errors = Array.isArray(errors) ? errors.filter((e) => typeof e === "string") : undefined;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  auth?: boolean; // default true
  // Zusätzliche Request-Header (z.B. X-Reauth-Token für den Deploy-Apply).
  headers?: Record<string, string>;
  // AbortSignal-Support fuer Consumer-seitigen Cleanup.
  // Verwendung im useEffect-Cleanup:
  //   const controller = new AbortController();
  //   api.get("/resource", undefined, { signal: controller.signal });
  //   return () => controller.abort();
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = opts;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // CSRF-Double-Submit für state-changing Methoden (Auth läuft über das Cookie).
  if (method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  // Zusätzliche, vom Aufrufer gesetzte Header (z.B. X-Reauth-Token). Nach den
  // Standard-Headern gemergt, damit gezielte Overrides möglich sind.
  if (opts.headers) Object.assign(headers, opts.headers);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'include',  // sendet das httpOnly soc_token-Cookie mit
    });
  } catch (err) {
    // AbortError sauber weitergeben — kein falscher Netzwerkfehler-Toast beim bewussten Abbrechen.
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new ApiError("Netzwerkfehler — Backend nicht erreichbar", 0, "NETWORK");
  }

  // 401 => Session ungueltig/abgelaufen (Cookie). AuthProvider raeumt den User-State auf.
  if (res.status === 401) {
    throw new ApiError("Nicht authentifiziert", 401, "UNAUTHORIZED");
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const d = data as { message?: string; error?: string; requestId?: string; errors?: string[] } | null;
    // errors[] mittragen (z.B. FP-Guardrail-Begründung) — sonst bliebe nur „HTTP 422".
    throw new ApiError(d?.message || `HTTP ${res.status}`, res.status, d?.error || "ERROR", d?.requestId, d?.errors);
  }

  return data as T;
}

export const api = {
  get:   <T>(path: string, query?: RequestOptions["query"], opts?: Pick<RequestOptions, "signal">) =>
    apiRequest<T>(path, { method: "GET", query, ...opts }),
  post:  <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, "signal" | "headers">) =>
    apiRequest<T>(path, { method: "POST", body, ...opts }),
  put:   <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, "signal">) =>
    apiRequest<T>(path, { method: "PUT", body, ...opts }),
  patch: <T>(path: string, body?: unknown, opts?: Pick<RequestOptions, "signal">) =>
    apiRequest<T>(path, { method: "PATCH", body, ...opts }),
  del:   <T>(path: string, opts?: Pick<RequestOptions, "signal">) =>
    apiRequest<T>(path, { method: "DELETE", ...opts }),
};