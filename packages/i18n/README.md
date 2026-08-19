# @fuzefront/i18n

Shared internationalization runtime for the FuzeFront shell and its
micro-frontends. Built on **i18next + react-i18next** — we adopt the runtime
rather than reinventing one.

This package is the **runtime** half of the build-time AI-translation model:

- English is the only maintained language. All other locale JSON is generated
  at **build time** by [`@fuzefront/i18n-translate`](../i18n-translate) and
  bundled by the frontend build.
- Git is the store. There is no translation service, database, or runtime
  spinner.
- Both **LTR and RTL** are supported; direction is centralized.

## Install

```bash
npm install @fuzefront/i18n
```

Published privately to GitHub Packages under the `@fuzefront` scope (configure a
scoped `.npmrc` + `GITHUB_TOKEN`).

## Usage

```tsx
import { I18nProvider, LanguageSelector, useT } from '@fuzefront/i18n'

// Locale JSON bundled by the frontend build, shaped for i18next.
import en from '../locales/en/common.json'
import es from '../locales/es/common.json'
// ...one import per shipped language

const resources = {
  en: { common: en },
  es: { common: es },
}

function App() {
  return (
    <I18nProvider resources={resources}>
      <Shell />
    </I18nProvider>
  )
}

function Header() {
  const { t } = useT()
  return (
    <header>
      <h1>{t('app.title')}</h1>
      <LanguageSelector />
    </header>
  )
}
```

## API

| Export | What it does |
| --- | --- |
| `<I18nProvider>` | Initializes i18next, loads bundled locale JSON, restores the saved language, and wires the direction manager. |
| `<LanguageSelector>` | Accessible picker built **only** from `@fuzefront/design-system` tokens; shows native language names; flips direction on change. |
| `useT(ns?)` | Re-export of `useTranslation`. |
| `setLanguage(i18n, code)` | Change + persist the active language. |
| `useDir(i18n)` / `applyDocumentDirection` / `attachDirectionManager` | Centralized RTL/LTR direction management. |
| `LANGUAGES`, `getLanguage`, `getDirection`, `isSupported` | The language registry. |

## RTL

Direction is derived from the active language via the registry and applied to
`<html dir>` + `<html lang>` by the centralized manager. **Design-system
components should style with CSS logical properties** (`margin-inline`,
`padding-inline`, `inset-inline-*`, `text-align: start/end`) so they mirror
automatically when `dir` flips — no per-component RTL branching.

## Adding a language

1. Add an entry to `i18n.languages.json` (repo root) with `code` + `dir`.
2. Add the same entry to `LANGUAGES` in `src/languages.ts`.
3. Rebuild — CI translates and opens a bot PR with the new locale files.
