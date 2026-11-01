import { Command } from 'commander'
import { existsSync } from 'fs'
import { installLocalCa } from '../core/certificate.js'
import {
  checkConfig,
  CONFIG_PATH,
  writeConfig,
  type Config,
} from '../core/config.js'
import { settings } from '../core/settings/index.js'
import {
  askConfirm,
  ensureBrewInstalled,
  hasCommand,
  installBrewPackages,
  isBrewPackageInstalled,
  logger,
} from '../utils/index.js'

const BREW_PACKAGES = [
  { name: 'mkcert', description: 'local certificate authority' },
  { name: 'nss', description: 'Firefox certificate trust support' },
  { name: 'dnsmasq', description: 'wildcard DNS resolver' },
]

const ensureDependencies = async (yes: boolean) => {
  logger.group('Dependencies')
  if (process.platform !== 'darwin') {
    if (!(await hasCommand('mkcert'))) {
      throw new Error('mkcert is required. Install it and run setup again.')
    }
    logger.success('mkcert installed')
    return
  }

  await ensureBrewInstalled('Homebrew is required for macOS DNS setup.')
  const missing = []
  for (const pkg of BREW_PACKAGES) {
    if (!(await isBrewPackageInstalled(pkg.name))) missing.push(pkg)
  }
  if (missing.length === 0) {
    logger.success(
      BREW_PACKAGES.map((pkg) => pkg.name).join(', ') + ' installed',
    )
    return
  }

  for (const pkg of missing)
    logger.info(`Missing ${pkg.name} (${pkg.description})`)
  const install =
    yes || (await askConfirm('Install them with Homebrew now?', true))
  if (!install) {
    throw new Error(
      'Setup needs these packages. Install them and run it again.',
    )
  }
  await installBrewPackages(missing.map((pkg) => pkg.name))
}

export type SetupOptions = {
  yes: boolean
  // Values given on the command line skip their prompt
  values?: Partial<Config>
}

// Asks for every setting (current value as default), saves them, then applies
// each one. Safe to re-run: valid certificates and DNS are left alone.
export const runSetup = async ({ yes, values = {} }: SetupOptions) => {
  await ensureDependencies(yes)
  await installLocalCa()

  // An invalid value (a hand edit) is asked again, and has nothing to clean
  // up: its certificate and resolver paths would point anywhere
  const { config: current, errors } = checkConfig()
  for (const { message } of errors) logger.warn(`${CONFIG_PATH}: ${message}`)
  const invalid = new Set(errors.map((error) => error.key))
  const previous = existsSync(CONFIG_PATH) ? current : null
  const next: Record<string, unknown> = { ...current }

  logger.group('Settings')
  for (const setting of settings) {
    const given = values[setting.key]
    next[setting.key] =
      given !== undefined
        ? setting.parse(String(given))
        : yes
          ? current[setting.key]
          : await setting.ask(current[setting.key])
  }
  const saved = next as Config
  writeConfig(saved)
  logger.success(`Saved in ${CONFIG_PATH}`)

  for (const setting of settings) {
    const before = invalid.has(setting.key) ? null : previous?.[setting.key]
    await setting.apply(saved[setting.key], before ?? null, {
      yes,
      review: true,
    })
  }
}

export const setupCommand = new Command('setup')
  .description('Set up or review the domain, HTTPS certificate and DNS')
  .option('-d, --domain <domain>', 'Domain for local services (dev.test)')
  .option('-y, --yes', 'Accept the current values and defaults', false)
  .action(async (options: { domain?: string; yes: boolean }) => {
    try {
      await runSetup({
        yes: options.yes,
        values: options.domain ? { domain: options.domain } : {},
      })
      logger.box(
        [
          'Setup complete',
          'Run `local-env start` to start the services.',
          'If Firefox warns, enable security.enterprise_roots.enabled in about:config.',
        ].join('\n'),
      )
    } catch (error) {
      logger.error('Setup failed:', error)
      process.exit(1)
    }
  })
