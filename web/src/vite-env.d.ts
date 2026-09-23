/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_X_AUTH_PROVIDER?: 'x' | 'twitter'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
