import { Command } from 'commander'
import { providers, provisionProviders } from '../providers/index.js'
import { ensureCertificate } from '../core/certificate.js'
import { readConfig } from '../core/config.js'
import { ensureRuntimeDirs } from '../core/home.js'
import { pullSources } from '../sources/sources.js'
import {
  runCompose,
  execDocker,
  isDockerRunning,
  logger,
} from '../utils/index.js'

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
    'Update everything: core services, sources and what was installed from them',
  )
  .option('-y, --yes', 'Sync stacks with their templates without asking', false)
  .option(
    '--dry-run',
    'Pull sources and show what would change, without touching containers',
    false,
  )
  .action(async (options: { yes: boolean; dryRun: boolean }) => {
    try {
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
      // Provisioning starts the providers' apps, so a dry run skips it
      if (!options.dryRun) await provisionProviders()

      const summary: string[] = []
      for (const provider of providers) {
        summary.push(...(await provider.update(options)))
      }

      if (!options.dryRun) {
        const { stdout } = await execDocker(['image', 'prune', '-f'], {
          capture: true,
        })
        const reclaimed = /Total reclaimed space: (.+)/.exec(stdout ?? '')?.[1]
        logger.success(`Pruned old images (${reclaimed ?? '0B'} reclaimed)`)
      }

      logger.box(
        [
          options.dryRun ? 'Dry run: nothing was changed' : 'Update complete',
          ...summary,
        ].join('\n'),
      )
    } catch (error) {
      logger.error('Update failed:', error)
      process.exit(1)
    }
  })
