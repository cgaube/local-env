// Preloaded before every test file (bunfig.toml). src/core/paths.ts reads
// LOCAL_ENV_HOME once, on import: unit tests get a temporary home before any
// of them imports src/, so they never touch ~/.local-env.
import { setDefaultTimeout } from 'bun:test'
import { mkdtempSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.LOCAL_ENV_HOME = realpathSync(
  mkdtempSync(join(tmpdir(), 'local-env-unit-')),
)
// Nothing reaches a real Dockhand, even by mistake
process.env.LOCAL_ENV_DOCKHAND_URL = 'http://127.0.0.1:9'

// e2e tests start the CLI and its fake binaries as processes
setDefaultTimeout(20_000)
