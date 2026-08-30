import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { profileApi } from '../features/profile/profileApi';
import { isSupportedLanguage, storeLanguage, type Language } from '../lib/language';

/**
 * Macht die Sprachwahl im Profil wirksam.
 *
 * Bis hierher war `language` im Profil eine Attrappe: Die Einstellung liess sich
 * speichern, hat aber keinen einzigen Text umgeschaltet. Diese Komponente schliesst
 * die Lücke — sie lädt das Profil, sobald jemand angemeldet ist, und übernimmt die
 * dort hinterlegte Sprache.
 *
 * Vor dem Login gilt weiter die aufgelöste Sprache aus localStorage/Browser (siehe
 * lib/language.ts) — der Login-Bildschirm kennt schliesslich noch kein Profil.
 *
 * Rendert nichts; gleiches Muster wie IdleGuard in App.tsx.
 */
export function LanguageProvider() {
  const { user } = useAuth();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();

    profileApi
      .getProfile({ signal: controller.signal })
      .then((profile) => {
        if (controller.signal.aborted) return;
        if (!isSupportedLanguage(profile.language)) return;
        applyLanguage(i18n, profile.language);
      })
      .catch(() => {
        /* Profil nicht ladbar → aufgelöste Sprache bleibt bestehen. Kein Grund,
           das UI zu blockieren; die Sprache ist keine sicherheitsrelevante Angabe. */
      });

    return () => controller.abort();
  }, [user, i18n]);

  // <html lang> mitführen: Screenreader und die Silbentrennung des Browsers
  // richten sich danach. Ohne das bliebe die Seite dauerhaft als 'en' deklariert.
  useEffect(() => {
    const current = i18n.language;
    if (isSupportedLanguage(current)) document.documentElement.lang = current;
  }, [i18n.language]);

  return null;
}

/** Sprache umschalten und für den nächsten Besuch merken. */
export function applyLanguage(i18n: { changeLanguage: (lng: string) => unknown }, language: Language): void {
  void i18n.changeLanguage(language);
  storeLanguage(language);
}
