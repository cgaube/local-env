import { Command } from 'commander'
import { existsSync } from 'fs'
import { CONFIG_PATH } from '#cli/core/config.js'
import { runStart } from '#cli/core/start.js'
import { askConfirm, logger } from '#cli/utils/index.js'
import { runSetup } from '#cli/commands/setup.js'

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
      await runStart({ build: options.build })
    } catch (error) {
      logger.error('Error starting services:', error)
      process.exit(1)
    }
  })
