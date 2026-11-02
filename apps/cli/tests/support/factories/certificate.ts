import { readFileSync } from 'fs'
import { join } from 'path'
import { TEST_DOMAIN } from './config.js'

const FIXTURES = join(import.meta.dir, '../../fixtures/certs')

// Real certificates for *.local-env-e2e.test (tests/fixtures/certs/README.md).
// The CLI only checks that the key file exists: no private key in the repo.
export const buildCertificate = (state: 'valid' | 'expired' = 'valid') => ({
  domain: TEST_DOMAIN,
  cert: readFileSync(join(FIXTURES, `${state}.crt`), 'utf8'),
  key: 'test key',
})
