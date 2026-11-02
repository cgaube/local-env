import { Command } from 'commander'
import { existsSync } from 'fs'
import { ensureCertificate } from '../core/certificate.js'
import { CONFIG_PATH, readConfig } from '../core/config.js'
import { ensureRuntimeDirs } from '../core/home.js'
import { provisionProviders } from '../providers/index.js'
import { askConfirm, logger, runCompose } from '../utils/index.js'
import { runSetup } from './setup.js'

// Without a domain, certificate and DNS the proxy can't serve anything
const ensureSetUp = async () => {
  if (existsSync(CONFIG_PATH)) return
  logger.warn('local-env is not set up yet')
  if (!(await askConfirm('Run setup now?', true))) {
    throw new Error('Run `local-env setup` first.')
  }
  await runSetup({ yes: false })
}

export const startCommand = new Command('start')
  .description('Start the proxy, Dockhand and the helper services')
  .option('-b, --build', 'Rebuild local images before starting', false)
  .action(async (options: { build: boolean }) => {
    try {
      await ensureSetUp()

      const { domain } = readConfig()

      // Renewed here too, so an expired certificate never lingers
      logger.group('Certificate')
      await ensureCertificate(domain)

      // Create it before compose so Docker doesn't create the bind mount itself
      ensureRuntimeDirs()

      logger.group('Core stack')
      const upArgs = ['up', '-d', '--wait', '--remove-orphans']
      if (options.build) upArgs.push('--build')
      await runCompose('Starting services', upArgs, {
        done: 'Services started',
      })

      // Idempotent: points every provider's app at the current sources
      await provisionProviders()

      // The dashboard: routes, apps, sources
      logger.success(`local-env is running: https://local-env.${domain}`)
    } catch (error) {
      logger.error('Error starting services:', error)
      process.exit(1)
    }
  })
