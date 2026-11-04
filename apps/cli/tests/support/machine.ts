// The state of the developer's Mac, through the fake binaries: Docker
// Desktop, Homebrew and its packages, mkcert
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FakeBin } from '#cli-tests/support/fake-bin.js'
import { buildCertificate } from '#cli-tests/support/factories/certificate.js'
import type { Cli } from '#cli-tests/support/run-cli.js'

// Docker Desktop is running and every compose command succeeds
export const dockerRunning = (bin: FakeBin) => {
  bin.on('docker', ['info'])
  bin.on('docker', ['compose'])
  bin.on('docker', ['ps'])
  bin.on('docker', ['images'])
  bin.on('docker', ['image', 'prune'], {
    stdout: 'Total reclaimed space: 0B\n',
  })
}

// Docker Desktop is stopped: every docker call fails
export const dockerStopped = (bin: FakeBin) => {
  bin.on('docker', [], {
    stderr: 'Cannot connect to the Docker daemon\n',
    exitCode: 1,
  })
}

// mkcert has a CA, which the user already trusts, and creates the fixture
// certificate. The fixture is self-signed: it is its own CA.
export const mkcertInstalled = (bin: FakeBin) => {
  const { cert, key } = buildCertificate()
  const caroot = join(bin.env.FAKE_BIN_STATE, 'mkcert')
  mkdirSync(caroot, { recursive: true })
  writeFileSync(join(caroot, 'rootCA.pem'), cert)
  bin.on('which', ['mkcert'])
  bin.on('mkcert', ['-CAROOT'], { stdout: `${caroot}\n` })
  bin.on('mkcert', ['-install'], { env: { TRUST_STORES: 'nss' } })
  bin.on('mkcert', ['-uninstall'], { env: { TRUST_STORES: 'nss' } })
  bin.on('security', ['verify-cert'])
  bin.on('security', ['remove-trusted-cert'])
  bin.on('mkcert', ['-cert-file'], {
    writeArgs: { '-cert-file': cert, '-key-file': key },
  })
}

// Homebrew under a temporary prefix, with these packages missing. dnsmasq
// accepts its config and sudo succeeds: the DNS setup goes through.
export const brewInstalled = (
  { bin, root }: Pick<Cli, 'bin' | 'root'>,
  { missing = [] as string[] } = {},
) => {
  const prefix = join(root, 'brew')
  bin.on('which', ['brew'])
  bin.on('brew', ['--prefix'], { stdout: `${prefix}\n` })
  bin.on('brew', ['list'])
  for (const name of missing) bin.on('brew', ['list', name], { exitCode: 1 })
  bin.on('brew', ['install'])
  bin.on('brew', ['services'])
  bin.stubAt(join(prefix, 'sbin/dnsmasq'), 'dnsmasq')
  bin.on('dnsmasq', ['--test'])
  bin.on('sudo', [])
  return { prefix }
}

// Everything `local-env setup` and `start` need
export const machineReady = (cli: Pick<Cli, 'bin' | 'root'>) => {
  dockerRunning(cli.bin)
  mkcertInstalled(cli.bin)
  brewInstalled(cli)
}
