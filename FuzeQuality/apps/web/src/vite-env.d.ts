/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FUZEQUALITY_API_URL?: string
  readonly FUZEQUALITY_DEV_AUTH_BYPASS: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
