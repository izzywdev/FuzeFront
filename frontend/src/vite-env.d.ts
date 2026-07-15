/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_WS_URL: string
  // Node-style env exposed by some tooling; not a standard Vite key, so it must
  // be declared explicitly (DEV/PROD/MODE/BASE_URL come from `vite/client`).
  readonly NODE_ENV?: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
