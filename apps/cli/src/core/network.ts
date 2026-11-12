import { execa } from 'execa'

// The network of the core services, where proxy-connector attaches every
// container with a VIRTUAL_HOST. Created here, before each `up`, and
// `external` in compose.yaml: `compose down` (`local-env stop`) would remove
// it, and the stopped apps attached to it could no longer start, as they
// keep the id of the network they joined. `reset` removes it.
export const PROXY_NETWORK = 'local-env'

export const ensureProxyNetwork = async () => {
  const { exitCode } = await execa(
    'docker',
    ['network', 'inspect', PROXY_NETWORK],
    { reject: false, stdio: 'ignore' },
  )
  if (exitCode === 0) return
  await execa('docker', [
    'network',
    'create',
    '--driver',
    'bridge',
    '--label',
    'local-env=proxy',
    PROXY_NETWORK,
  ])
}
