/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  /**
   * Present only inside the LiveCut Electron desktop shell (see `electron/`).
   * Undefined in a plain browser — every branch keyed off it is a no-op there.
   */
  livecut?: {
    isDesktop: boolean
    version: string
    platform?: 'darwin' | 'win32'
  }
}
