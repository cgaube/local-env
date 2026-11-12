import { syncBuildContexts } from '#cli/sources/sources.js'
import { execCompose, runCompose } from '#cli/utils/exec.js'
import { logger } from '#cli/utils/logger.js'
import { runStep } from '#cli/utils/task.js'
import type { Provider, UpdateOptions } from '#cli/providers/types.js'
import {
  findContainerUpdates,
  updateContainers,
} from '#cli/providers/docker/container-updates.js'
import { getLocalEnvironment } from '#cli/providers/docker/environments.js'
import { registryLoginsStep } from '#cli/logins/registry.js'
import { offerStackSync } from '#cli/providers/docker/stack-sync.js'
import { autoUpdateStep } from '#cli/providers/docker/steps/auto-update.js'
import { exposureWarningStep } from '#cli/providers/docker/steps/exposure-warning.js'
import { localEnvironmentStep } from '#cli/providers/docker/steps/local-environment.js'
import { sidebarStep } from '#cli/providers/docker/steps/sidebar.js'
import {
  ownTemplateSourcesStep,
  removeBuiltinTemplatesStep,
} from '#cli/providers/docker/steps/template-sources.js'
import type { DockhandStep } from '#cli/providers/docker/types.js'

// Steps run in order; add new provisioning steps here
const steps: DockhandStep[] = [
  localEnvironmentStep,
  exposureWarningStep,
  autoUpdateStep,
  sidebarStep,
  removeBuiltinTemplatesStep,
  ownTemplateSourcesStep,
  // Last: it may ask questions, after the steps that need none
  registryLoginsStep,
]

// The services provisioning starts: Dockhand and the server of its templates
const DOCKHAND_SERVICES = ['dockhand', 'catalog-server']

const provision = async () => {
  logger.group('Dockhand')
  // catalog-server serves them to Docker's builder
  await syncBuildContexts()
  await runCompose(
    'Starting Dockhand',
    ['up', '-d', '--wait', ...DOCKHAND_SERVICES],
    { done: 'Dockhand running' },
  )

  // One line, only when a step changed something: which settings did is
  // detail for the people who change local-env
  let changed = false
  for (const step of steps) {
    if ((await step.run()) !== 'unchanged') changed = true
  }
  if (changed) logger.success('Dockhand set up for local-env')
}

// For `sources sync`, after the pull: the part of provisioning a template
// change needs, printed only when it does something. Starts Dockhand and
// catalog-server if needed (the sync uses them).
export const refreshDockhand = async () => {
  const { stdout } = await execCompose(
    ['ps', '--status', 'running', '--services', ...DOCKHAND_SERVICES],
    { capture: true },
  )
  const running = (stdout ?? '').split('\n').filter(Boolean)
  if (running.length < DOCKHAND_SERVICES.length) {
    await runCompose(
      'Starting Dockhand',
      ['up', '-d', '--wait', ...DOCKHAND_SERVICES],
      { done: 'Dockhand running' },
    )
  }
  // A pulled source can need a new registry login
  if ((await registryLoginsStep.run()) !== 'unchanged') {
    logger.success('Registry logins saved in Dockhand')
  }
}

// Deployed stacks only: `update` refreshes the core stack through compose
const updateStackImages = async (dryRun: boolean) => {
  const environment = await getLocalEnvironment()
  const updates = await runStep('Checking for image updates', () =>
    findContainerUpdates(environment.id),
  )
  if (updates.length === 0) {
    logger.success('All containers up to date')
    return []
  }

  const names = updates.map((update) => update.containerName)
  if (dryRun) {
    logger.info(`Updates available for ${names.join(', ')}`)
    return []
  }

  const results = await runStep(`Updating ${names.join(', ')}`, () =>
    updateContainers(
      environment.id,
      updates.map((update) => update.containerId),
    ),
  )
  const updated: string[] = []
  for (const result of results) {
    if (result.success) {
      updated.push(result.containerName)
      logger.success(`Updated ${result.containerName}`)
    } else {
      logger.warn(`${result.containerName} failed: ${result.error}`)
    }
  }
  return updated
}

const update = async (options: UpdateOptions) => {
  logger.group('Stacks')
  // Lists the template changes and syncs only on approval
  const { applied: synced, rebuilt } = await offerStackSync(options)

  logger.group('Images')
  const updated = await updateStackImages(options.dryRun)

  return [
    `Stacks synced: ${synced.length ? synced.join(', ') : 'none'}`,
    ...(rebuilt.length ? [`Stacks rebuilt: ${rebuilt.join(', ')}`] : []),
    `Images updated: ${updated.length ? updated.join(', ') : 'none'}`,
  ]
}

export const dockerProvider: Provider = { name: 'docker', provision, update }
