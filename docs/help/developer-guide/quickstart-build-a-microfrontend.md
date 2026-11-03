---
title: "Quickstart: Build a Micro-frontend"
description: Create a Vite React remote, expose it with Module Federation, and build it so the FuzeFront shell can load it.
audience: developer
order: 2
owner: "@izzywdev"
lastReviewed: 2026-10-26
status: published
---

# Quickstart: Build a Micro-frontend

This walks through the smallest working remote. The in-repo reference is `clock-app/`; everything below mirrors its `vite.config.ts`.

## Prerequisites

- Node `>=24.0.0` and npm `>=10.0.0` (check with `node -v`).
- You will use React `^19.2.0`. A React 18 app will not work: the shell shares React 19 as a singleton.

## 1. Create the app

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install
npm install --save-dev @originjs/vite-plugin-federation
npm install react@^19.2.0 react-dom@^19.2.0
npm install --save-dev @types/react@^19.2.0 @types/react-dom@^19.2.0 @types/node@^24.13.3
```

This repository's host builds with Vite 6 and `clock-app` with Vite 5.4. A fresh template currently installs a newer Vite, and the config below still builds and emits `remoteEntry.js` there, but the in-repo combination is the one exercised in CI against the shell. If you hit plugin incompatibilities, align with the host's Vite major and the matching `@vitejs/plugin-react`.

The template's `build` script runs `tsc -b`, which type-checks `vite.config.ts` and rejects the federation plugin's default import. Change the script in `package.json` so only application code is type-checked:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.app.json --noEmit && vite build"
  }
}
```

Add the engine floor to `package.json`:

```json
{
  "engines": { "node": ">=24.0.0", "npm": ">=10.0.0" }
}
```

## 2. Write the component the shell will mount

The shell imports one default-exported React component. Keep it self-contained.

```tsx
// src/App.tsx
export default function App() {
  return <section>Hello from my micro-frontend</section>
}
```

## 3. Configure Module Federation

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'myApp',                       // becomes integration.scope
      filename: 'remoteEntry.js',
      exposes: { './App': './src/App.tsx' }, // becomes integration.module
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' } as any,
      },
    }),
  ],
  base: '/apps/my-app/',                   // must match the path you serve and register
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    assetsDir: '',                          // chunks next to remoteEntry.js
  },
})
```

Three values here are contracts, not preferences:

- `shared` must use **explicit singletons** with `requiredVersion: '^19.0.0'`, identical to the host. The bare `['react', 'react-dom']` shorthand does not set `singleton` and lets your remote load its own React.
- `name` and the `exposes` key become the `scope` and `module` you register.
- `base` and `assetsDir` decide where chunks resolve from. If they disagree with where you serve the app, `remoteEntry.js` loads and every chunk 404s. See [The Module Federation contract](module-federation-contract.md).

## 4. Build and check the output

```bash
npm run build
ls dist
```

You should see `remoteEntry.js` directly in `dist/` alongside the chunks (because `assetsDir` is empty). With the config above the entry is served at `/apps/my-app/remoteEntry.js`.

## 5. Use the platform, not your own plumbing

- Call the API on a **same-origin** relative path such as `/api/v1/security/session`. Never hard-code an absolute API host.
- Style with design-system tokens ([Design system](design-system.md)).
- Get identity and permissions from the Security API ([Authentication and authorization](authentication-and-authorization.md)).
- To show a toast or read live platform context, use the host bridge on `window.__FUZEFRONT__` (see `frontend/src/platform/bridge.ts`); feature-detect it, since your app may also run standalone.

## 6. Register and deploy

A built remote does nothing until it is registered and served. Continue with [Registering your app](registering-your-app.md) for the manifest, then [Deployment](deployment.md) for how it reaches the cluster. If the panel renders blank or the console shows "Invalid hook call", go to [Troubleshooting](troubleshooting.md).
