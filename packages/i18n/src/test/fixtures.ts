import type { Resource } from 'i18next'

/** Minimal multi-language resource bundle covering LTR + RTL for tests. */
export const resources: Resource = {
  en: {
    common: {
      'app.title': 'FuzeFront',
      'greeting.welcome': 'Welcome back, {{name}}.',
      'language.label': 'Language',
    },
  },
  es: {
    common: {
      'app.title': 'FuzeFront',
      'greeting.welcome': 'Bienvenido de nuevo, {{name}}.',
      'language.label': 'Idioma',
    },
  },
  ar: {
    common: {
      'app.title': 'FuzeFront',
      'greeting.welcome': 'مرحبًا بعودتك، {{name}}.',
      'language.label': 'اللغة',
    },
  },
  he: {
    common: {
      'app.title': 'FuzeFront',
      'greeting.welcome': 'ברוך שובך, {{name}}.',
      'language.label': 'שפה',
    },
  },
}
