/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FUZEQUALITY_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
