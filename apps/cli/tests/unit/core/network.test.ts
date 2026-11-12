import { readFileSync } from 'fs'
import { join } from 'path'
import { PROXY_NETWORK } from '#cli/core/network.js'

// `local-env stop` runs `compose down`: a network compose owns goes with
// it, and the stopped apps attached to it can no longer start
test('compose.yaml leaves the proxy network to the CLI', () => {
  const compose = Bun.YAML.parse(
    readFileSync(join(import.meta.dir, '../../../../../compose.yaml'), 'utf8'),
  ) as { networks: { default: { name: string; external?: boolean } } }

  expect(compose.networks.default).toEqual({
    name: PROXY_NETWORK,
    external: true,
  })
})
