// Set by vite.config.ts at build time. moduleDetection: force makes this file
// a module, so the global is declared explicitly.
declare global {
  const __LOCAL_ENV_BUILD__: {
    version: string
    // release: the Homebrew binary; checkout: `bun run compile`; dev-server:
    // `bun run dev`
    kind: 'release' | 'checkout' | 'dev-server'
    commit: string | null
  }
}

export {}
