import { Command } from 'commander'
import { existsSync } from 'fs'
import { ensureAgent } from '#cli/core/agent.js'
import { ensureCertificate } from '#cli/core/certificate.js'
import { CONFIG_PATH, readConfig } from '#cli/core/config.js'
import { ensureRuntimeDirs } from '#cli/core/home.js'
import { provisionProviders } from '#cli/providers/index.js'
import { askConfirm, logger, runCompose } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
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

      // Runs install and update for the dashboard. Started with the core
      // services: nothing restarts either of them on its own.
      logger.group('Dashboard agent')
      const agent = await ensureAgent()
      if (agent.state === 'busy') {
        logger.warn(
          `The dashboard agent of local-env ${agent.version} is running a command: run \`local-env start\` again once it ends`,
        )
      } else {
        logger.success(
          agent.state === 'running'
            ? 'Dashboard agent running'
            : agent.state === 'started'
              ? 'Dashboard agent started'
              : 'Dashboard agent restarted',
        )
      }

      // Last, in green, in place of "Done": where to go next
      closeFrameWithCallout(
        'success',
        [
          'local-env is running',
          `Dashboard: https://local-env.${domain}`,
          // VIRTUAL_HOST of dockhand in compose.yaml
          `Dockhand:  https://docker.${domain}`,
        ].join('\n'),
        { tinted: true },
      )
    } catch (error) {
      logger.error('Error starting services:', error)
      process.exit(1)
    }
  })
