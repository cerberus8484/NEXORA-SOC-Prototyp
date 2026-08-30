// Sprachauflösung — bewusst reine Logik ohne React und ohne i18next.
//
// Warum getrennt: Welche Sprache ein Nutzer bekommt, entscheidet sich aus drei
// Quellen mit klarer Rangfolge. Diese Regel ist testbar und darf nicht in einem
// Provider-Effekt versteckt liegen, wo sie nur über das gerenderte UI prüfbar wäre.

/** Ausgelieferte Übersetzungskataloge. Reihenfolge = Anzeigereihenfolge in der UI. */
export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Englisch ist der Standard: Nexora richtet sich an ein internationales Publikum,
 * und ein deutschsprachiges UI wäre für die Mehrheit der Prüfer unbenutzbar.
 * Deutsch bleibt vollwertig — nur eben als Wahl, nicht als Voreinstellung.
 */
export const DEFAULT_LANGUAGE: Language = 'en';

/** localStorage-Schlüssel für die zuletzt gewählte Sprache (auch vor dem Login gültig). */
export const LANGUAGE_STORAGE_KEY = 'nexora.language';

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Macht aus einem BCP-47-Tag die Basissprache ('en-US' → 'en'), sofern unterstützt.
 * Gibt null zurück, wenn daraus keine ausgelieferte Sprache wird — der Aufrufer
 * entscheidet dann selbst, ob er weitersucht oder auf den Standard fällt.
 */
export function normalizeLanguageTag(tag: string | null | undefined): Language | null {
  if (typeof tag !== 'string' || tag === '') return null;
  const base = tag.toLowerCase().split('-')[0];
  return isSupportedLanguage(base) ? base : null;
}

interface ResolveInput {
  /** Zuletzt gespeicherte Wahl (localStorage). Inhalt ist ungeprüft. */
  stored?: string | null;
}

/**
 * Rangfolge: ausdrückliche Wahl des Nutzers → Englisch.
 *
 * Bewusst OHNE Auswertung der Browsersprache. Das wäre zwar üblich, würde hier
 * aber die Vorgabe aushebeln: Auf einem deutschsprachigen Rechner bekäme Nexora
 * nie sein englisches Gesicht zu sehen — und "Englisch als Standard" wäre eine
 * Einstellung, die in der Praxis nie greift. Wer Deutsch will, wählt es einmal
 * im Profil; die Wahl überlebt den nächsten Besuch.
 */
export function resolveInitialLanguage({ stored }: ResolveInput = {}): Language {
  return normalizeLanguageTag(stored) ?? DEFAULT_LANGUAGE;
}

/** Liest die gespeicherte Wahl. Fehlt der Zugriff (Privatmodus), ist das kein Fehler. */
export function readStoredLanguage(): Language | null {
  try {
    return normalizeLanguageTag(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Merkt die Wahl für den nächsten Besuch — auch für den Login-Bildschirm, der kein Profil kennt. */
export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* Kein Storage verfügbar → Wahl gilt nur für diese Sitzung. */
  }
}
