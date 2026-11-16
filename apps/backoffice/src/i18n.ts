/**
 * Languages (ADR 0035): English in the code, Swedish from locales/sv.ts, and Web
 * Awesome's own Swedish texts. The choice is kept for the session only.
 */
import { configureLocalization } from '@lit/localize';
import '@awesome.me/webawesome/dist/translations/sv.js';

export const LOCALES = ['sv', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const { getLocale, setLocale } = configureLocalization({
  sourceLocale: 'en',
  targetLocales: ['sv'],
  loadLocale: async () => import('./locales/sv.ts'),
});

/** The locale to start with: the session's choice, else the browser's, else Swedish. */
export function initialLocale(): Locale {
  try {
    const saved = sessionStorage.getItem('pv-locale');
    if (saved === 'sv' || saved === 'en') return saved;
  } catch {
    // No session storage, e.g. in a private window: fall through.
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'sv';
}

export async function useLocale(locale: Locale): Promise<void> {
  await setLocale(locale);
  document.documentElement.lang = locale;
  try {
    sessionStorage.setItem('pv-locale', locale);
  } catch {
    // Kept for this page only.
  }
}
