import { Command } from 'commander'
import { providers, provisionProviders } from '#cli/providers/index.js'
import { ensureCertificate } from '#cli/core/certificate.js'
import { readConfig } from '#cli/core/config.js'
import { ensureRuntimeDirs } from '#cli/core/home.js'
import { updateSelf } from '#cli/core/self-update.js'
import { pullSources } from '#cli/sources/sources.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
import { upgradeGalaxyCollections } from '#cli/core/tools.js'
import { offerBootstraps } from '#cli/core/bootstrap.js'
import { runStep } from '#cli/utils/task.js'
import {
  runCompose,
  execDocker,
  isDockerRunning,
  logger,
} from '#cli/utils/index.js'

// Pulls and rebuilds the core stack, including the base images of the local
// builds, then recreates whatever changed
const updateCoreStack = async () => {
  logger.group('Core stack')
  ensureRuntimeDirs()
  await runCompose('Pulling core images', ['pull', '--ignore-buildable'], {
    done: 'Core images pulled',
  })
  await runCompose('Rebuilding local images', ['build', '--pull'], {
    done: 'Local images rebuilt',
  })
  await runCompose(
    'Restarting changed services',
    ['up', '-d', '--wait', '--remove-orphans'],
    { done: 'Core services running' },
  )
}

export const updateCommand = new Command('update')
  .description(
    'Update everything: local-env, core services, sources and what was installed from them',
  )
  .option(
    '-y, --yes',
    'Sync stacks with their templates and run changed bootstraps without asking',
    false,
  )
  .option(
    '--dry-run',
    'Pull sources and show what would change, without touching containers',
    false,
  )
  .action(async (options: { yes: boolean; dryRun: boolean }) => {
    try {
      // Hands over to the new version, if Homebrew installs one
      await updateSelf(options)

      if (!(await isDockerRunning())) {
        logger.error('Docker is not running. Start Docker and retry.')
        process.exit(1)
      }

      logger.group('Certificate')
      if (options.dryRun) {
        logger.info('Skipped (dry run)')
      } else {
        await ensureCertificate(readConfig().domain)
      }

      if (options.dryRun) {
        logger.group('Core stack')
        logger.info('Skipped (dry run)')
      } else {
        await updateCoreStack()
      }

      await pullSources()
      // A bootstrap that changed, asked before the provisioning: it may set
      // up what the registry logins use
      if (!options.dryRun)
        await offerBootstraps({ yes: options.yes, changedOnly: true })
      // Provisioning starts the providers' apps, so a dry run skips it
      if (!options.dryRun) await provisionProviders()

      const summary: string[] = []
      for (const provider of providers) {
        summary.push(...(await provider.update(options)))
      }

      if (!options.dryRun) {
        const { stdout } = await runStep('Pruning old images', () =>
          execDocker(['image', 'prune', '-f'], { capture: true }),
        )
        const reclaimed = /Total reclaimed space: (.+)/.exec(stdout ?? '')?.[1]
        logger.success(`Pruned old images (${reclaimed ?? '0B'} reclaimed)`)
      }
      // After the pull: the ranges of galaxy.yml are the sources' latest
      summary.push(...(await upgradeGalaxyCollections(options)))

      // Last, in place of "Done": green, its lines dimmed; blue for a dry run
      closeFrameWithCallout(
        options.dryRun ? 'info' : 'success',
        [
          options.dryRun ? 'Dry run: nothing was changed' : 'Update complete',
          ...summary,
        ].join('\n'),
        { tinted: true },
      )
    } catch (error) {
      logger.error('Update failed:', error)
      process.exit(1)
    }
  })
