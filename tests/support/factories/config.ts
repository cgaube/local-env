import type { Config } from '../../../src/core/config.js'

// Neither may match the developer's real setup: the CLI reads
// /etc/resolver/<domain> and checks whether the build port is free
export const TEST_DOMAIN = 'local-env-e2e.test'
export const TEST_BUILD_PORT = 47080

export const buildConfig = (overrides: Partial<Config> = {}): Config => ({
  domain: TEST_DOMAIN,
  buildPort: TEST_BUILD_PORT,
  ...overrides,
})
