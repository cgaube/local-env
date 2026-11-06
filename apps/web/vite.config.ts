import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import cli from '../../package.json' with { type: 'json' }

// `bun run dev` shows the live data of your running local-env, at the domain
// of its config.json. Read only then: builds and tests don't need it.
// The home folder as apps/cli/src/core/paths.ts finds it, and the default
// domain of apps/cli/src/core/config.ts
const readDomain = () => {
  const home = process.env.LOCAL_ENV_HOME
    ? resolve(process.env.LOCAL_ENV_HOME)
    : join(homedir(), '.local-env')
  try {
    const { domain } = JSON.parse(
      readFileSync(join(home, 'config.json'), 'utf8'),
    )
    if (typeof domain === 'string' && domain) return domain
  } catch {
    // No config.json yet
  }
  return 'dev.test'
}

const dashboardUrl = () =>
  process.env.LOCAL_ENV_DASHBOARD_URL ?? `https://local-env.${readDomain()}`

// The commit the build comes from, with -dirty for uncommitted changes
const commit = () => {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: import.meta.dirname, encoding: 'utf8' })
  try {
    const sha = git('rev-parse', '--short', 'HEAD').trim()
    return git('status', '--porcelain').trim() ? `${sha}-dirty` : sha
  } catch {
    return null
  }
}

// The dashboard served at https://local-env.<domain>. The build goes into the
// dashboard service, which the CLI embeds with the rest of the core stack.
export default defineConfig(({ command, mode }) => ({
  // The scripts run from the repo root, with --config
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  // The CLI's version, which ships this build (`local-env --version`), and
  // where the build comes from: the release workflow sets LOCAL_ENV_RELEASE,
  // any other build is one of a checkout
  define: {
    __LOCAL_ENV_BUILD__: JSON.stringify({
      version: cli.version,
      kind:
        process.env.LOCAL_ENV_RELEASE === '1'
          ? 'release'
          : command === 'serve' && mode !== 'test'
            ? 'dev-server'
            : 'checkout',
      commit: commit(),
    }),
  },
  // #ui/* and the other aliases of tsconfig.base.json
  resolve: { tsconfigPaths: true },
  build: {
    outDir: '../../services/dashboard/public',
    emptyOutDir: true,
    // One bundle of about 500 kB, served from this Mac: not worth splitting
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'jsdom',
    // describe, test, expect without imports, like the CLI's tests
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  server:
    command === 'serve' && mode !== 'test'
      ? {
          proxy: {
            '/api': {
              target: dashboardUrl(),
              changeOrigin: true,
              // The mkcert CA isn't in Node's trust store
              secure: false,
              // /api/terminal, the dashboard agent's WebSocket. The dashboard
              // takes only its own pages' Origin.
              ws: true,
              configure: (proxy) => {
                proxy.on('proxyReqWs', (request) =>
                  request.setHeader('Origin', dashboardUrl()),
                )
              },
            },
          },
        }
      : undefined,
}))
