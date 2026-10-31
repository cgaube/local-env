import { execa } from 'execa'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { getBrewPrefix } from '../utils/brew.js'
import {
  DNSMASQ_CONFIG_NAME,
  DNSMASQ_PORT,
  findConflictingDnsmasqConfigs,
  getDnsmasqPaths,
  testDnsmasqConfig,
} from '../utils/dnsmasq.js'
import { logger } from '../utils/logger.js'
import { askConfirm } from '../utils/prompt.js'

// macOS sends every *.<domain> lookup to dnsmasq on 127.0.0.1:53535, which
// answers 127.0.0.1, where nginx listens

const resolverPath = (domain: string) => `/etc/resolver/${domain}`

const dnsmasqConfig = (domain: string) =>
  [
    'listen-address=127.0.0.1',
    `port=${DNSMASQ_PORT}`,
    `address=/${domain}/127.0.0.1`,
    '',
  ].join('\n')

const resolverConfig = [
  'nameserver 127.0.0.1',
  `port ${DNSMASQ_PORT}`,
  '',
].join('\n')

const requireBrewPrefix = async () => {
  const brewPrefix = await getBrewPrefix()
  if (!brewPrefix) {
    throw new Error('Homebrew is required for dnsmasq setup on macOS.')
  }
  return brewPrefix
}

const readOr = (path: string) =>
  existsSync(path) ? readFileSync(path, 'utf8') : null

const resolvesLocally = async (domain: string) => {
  const { stdout } = await execa(
    'dig',
    [
      '+short',
      '+time=1',
      '+tries=1',
      `doctor.${domain}`,
      '@127.0.0.1',
      '-p',
      String(DNSMASQ_PORT),
    ],
    { reject: false, stdio: 'pipe' },
  ).catch(() => ({ stdout: '' }))
  return stdout.split('\n').includes('127.0.0.1')
}

// True when the configs are in place and dnsmasq answers: nothing to redo
const isDnsConfigured = async (domain: string, brewPrefix: string) => {
  const { configDir } = getDnsmasqPaths(brewPrefix)
  return (
    readOr(join(configDir, DNSMASQ_CONFIG_NAME)) === dnsmasqConfig(domain) &&
    readOr(resolverPath(domain)) === resolverConfig &&
    (await resolvesLocally(domain))
  )
}

const restartDnsmasqService = async (brewPrefix: string) => {
  const brewBinary = join(brewPrefix, 'bin', 'brew')
  const userLaunchAgentPath = join(
    homedir(),
    'Library',
    'LaunchAgents',
    'homebrew.mxcl.dnsmasq.plist',
  )

  // dnsmasq must run as root; a per-user service would hold the port
  if (existsSync(userLaunchAgentPath)) {
    logger.warn('Stopping the per-user dnsmasq service')
    await execa('brew', ['services', 'stop', 'dnsmasq'], {
      reject: false,
      stdio: 'ignore',
    })
  }

  await execa('sudo', [brewBinary, 'services', 'restart', 'dnsmasq'], {
    stdin: 'inherit',
    stdout: 'ignore',
    stderr: 'inherit',
  })
}

// Disables other dnsmasq.d configs that set `port`, which would stop dnsmasq
// from starting. The main dnsmasq.conf is the user's, so only report it.
const resolveDnsmasqConflicts = async (brewPrefix: string, yes: boolean) => {
  const { mainConfig } = getDnsmasqPaths(brewPrefix)
  const conflicts = findConflictingDnsmasqConfigs(brewPrefix)
  if (conflicts.includes(mainConfig)) {
    throw new Error(
      `${mainConfig} sets \`port\`, which conflicts with ${DNSMASQ_CONFIG_NAME}. Comment out that line and retry.`,
    )
  }

  for (const file of conflicts) {
    const disable =
      yes ||
      (await askConfirm(
        `${file} also sets the dnsmasq port, so dnsmasq can't start. Rename it to ${file}.bak?`,
        true,
      ))
    if (!disable) {
      throw new Error(`dnsmasq can't start while ${file} sets \`port\`.`)
    }
    renameSync(file, `${file}.bak`)
    logger.success(`Disabled conflicting dnsmasq config: ${file}.bak`)
  }
}

const writeResolver = async (domain: string) => {
  const tmpFile = join(tmpdir(), `local-env-resolver-${domain}`)
  writeFileSync(tmpFile, resolverConfig)
  try {
    const sudo = {
      stdin: 'inherit',
      stdout: 'ignore',
      stderr: 'inherit',
    } as const
    await execa('sudo', ['mkdir', '-p', '/etc/resolver'], sudo)
    await execa('sudo', ['cp', tmpFile, resolverPath(domain)], sudo)
  } finally {
    unlinkSync(tmpFile)
  }
}

// Points *.<domain> at 127.0.0.1. Asks for sudo only when something changed.
export const ensureWildcardDns = async (domain: string, yes: boolean) => {
  if (process.platform !== 'darwin') {
    logger.warn('Automatic DNS setup is only implemented for macOS')
    return
  }

  const brewPrefix = await requireBrewPrefix()
  if (await isDnsConfigured(domain, brewPrefix)) {
    logger.success(`*.${domain} resolves to 127.0.0.1`)
    return
  }

  const { configDir } = getDnsmasqPaths(brewPrefix)
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, DNSMASQ_CONFIG_NAME), dnsmasqConfig(domain))

  await resolveDnsmasqConflicts(brewPrefix, yes)
  const configTest = await testDnsmasqConfig(brewPrefix)
  if (!configTest.ok) {
    throw new Error(`Invalid dnsmasq config: ${configTest.output}`)
  }

  logger.info('Configuring DNS (may ask for your password)')
  await restartDnsmasqService(brewPrefix)
  await writeResolver(domain)
  logger.success(`*.${domain} resolves to 127.0.0.1`)
}

// After a domain change: the old resolver file would keep routing its lookups
export const removeResolver = async (domain: string) => {
  if (process.platform !== 'darwin' || !existsSync(resolverPath(domain))) {
    return
  }
  await execa('sudo', ['rm', '-f', resolverPath(domain)], {
    stdin: 'inherit',
    stdout: 'ignore',
    stderr: 'inherit',
  })
  logger.success(`Removed ${resolverPath(domain)}`)
}

// Undoes ensureWildcardDns. dnsmasq keeps running only if other configs still
// use it.
export const removeWildcardDns = async (domain: string) => {
  if (process.platform !== 'darwin') return

  await removeResolver(domain)
  const brewPrefix = await getBrewPrefix()
  if (!brewPrefix) return

  const { configDir } = getDnsmasqPaths(brewPrefix)
  const ownConfig = join(configDir, DNSMASQ_CONFIG_NAME)
  if (!existsSync(ownConfig)) return
  unlinkSync(ownConfig)
  logger.success(`Removed ${ownConfig}`)

  const othersRemain = readdirSync(configDir).some((name) =>
    name.endsWith('.conf'),
  )
  const brewBinary = join(brewPrefix, 'bin', 'brew')
  await execa(
    'sudo',
    [brewBinary, 'services', othersRemain ? 'restart' : 'stop', 'dnsmasq'],
    { stdin: 'inherit', stdout: 'ignore', stderr: 'inherit', reject: false },
  )
  logger.success(othersRemain ? 'Restarted dnsmasq' : 'Stopped dnsmasq')
}
