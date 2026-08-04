import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { TranslationKey } from './i18n-types.js';

export type Locale = 'en' | 'ko';

type Dictionary = Record<TranslationKey, string>;
type Dictionaries = Record<Locale, Dictionary>;

function embeddedDictionaries(): Dictionaries {
  const container = document.getElementById('engrove-translations');
  const source =
    container instanceof HTMLTemplateElement
      ? container.content.textContent
      : container?.textContent;
  if (!source) throw new Error('TRANSLATIONS_NOT_EMBEDDED');
  const parsed = JSON.parse(source) as Partial<Dictionaries>;
  if (!parsed.en || !parsed.ko) throw new Error('TRANSLATIONS_INVALID');
  return parsed as Dictionaries;
}

const dictionaries = embeddedDictionaries();

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  formatDate: (value: Date | string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatTime: (value: Date | string, options?: Intl.DateTimeFormatOptions) => string;
}

function translate(locale: Locale, key: TranslationKey, values?: Record<string, string | number>) {
  let result = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) {
    result = result.replaceAll(`{${name}}`, String(value));
  }
  return result;
}

const I18nContext = createContext<I18nValue>({
  locale: 'en',
  setLocale: () => undefined,
  t: (key, values) => translate('en', key, values),
  formatDate: (value, options) =>
    new Intl.DateTimeFormat('en', options).format(
      typeof value === 'string' ? new Date(value) : value,
    ),
  formatNumber: (value, options) => new Intl.NumberFormat('en', options).format(value),
  formatTime: (value, options) =>
    new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(typeof value === 'string' ? new Date(value) : value),
});

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<Locale>(() =>
    window.localStorage.getItem('engrove-locale') === 'ko' ? 'ko' : 'en',
  );

  useEffect(() => {
    window.localStorage.setItem('engrove-locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
      formatDate: (input, options) =>
        new Intl.DateTimeFormat(locale, options).format(
          typeof input === 'string' ? new Date(input) : input,
        ),
      formatNumber: (input, options) => new Intl.NumberFormat(locale, options).format(input),
      formatTime: (input, options) =>
        new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          ...options,
        }).format(typeof input === 'string' ? new Date(input) : input),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
