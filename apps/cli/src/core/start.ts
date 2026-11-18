import { runAgentStep } from '#cli/core/agent.js'
import { ensureCertificate } from '#cli/core/certificate.js'
import { readConfig } from '#cli/core/config.js'
import { ensureRuntimeDirs } from '#cli/core/home.js'
import { provisionProviders } from '#cli/providers/index.js'
import { logger, runCompose } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'

// Starts the core stack, configures Dockhand and the dashboard agent. Run by
// `local-env start`, by `local-env setup` when the user accepts to start, and
// by `local-env onboard`, which says where to go next itself (`summary:
// false`).
export const runStart = async ({
  build,
  summary = true,
}: {
  build: boolean
  summary?: boolean
}) => {
  const { domain } = readConfig()

  // Renewed here too, so an expired certificate never lingers
  logger.group('Certificate')
  await ensureCertificate(domain)

  // Create it before compose so Docker doesn't create the bind mount itself
  ensureRuntimeDirs()

  logger.group('Core stack')
  const upArgs = ['up', '-d', '--wait', '--remove-orphans']
  if (build) upArgs.push('--build')
  await runCompose('Starting services', upArgs, {
    done: 'Services started',
  })

  // Idempotent: points every provider's app at the current sources
  await provisionProviders()

  // Runs install and update for the dashboard. Started with the core
  // services: nothing restarts either of them on its own.
  await runAgentStep()

  if (!summary) return
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
}
