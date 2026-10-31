import { syncBuildContexts } from '../../sources/sources.js'
import { execCompose, runCompose } from '../../utils/exec.js'
import { logger } from '../../utils/logger.js'
import type { Provider, UpdateOptions } from '../types.js'
import { findContainerUpdates, updateContainers } from './container-updates.js'
import { getLocalEnvironment } from './environments.js'
import { offerStackSync } from './stack-sync.js'
import { autoUpdateStep } from './steps/auto-update.js'
import { exposureWarningStep } from './steps/exposure-warning.js'
import { localEnvironmentStep } from './steps/local-environment.js'
import {
  removeBuiltinTemplatesStep,
  templateSourcesStep,
} from './steps/template-sources.js'
import type { DockhandStep } from './types.js'

// Steps run in order; add new provisioning steps here
const steps: DockhandStep[] = [
  localEnvironmentStep,
  exposureWarningStep,
  autoUpdateStep,
  removeBuiltinTemplatesStep,
  templateSourcesStep,
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

  const changes: string[] = []
  for (const step of steps) {
    const result = await step.run()
    if (result !== 'unchanged') changes.push(`${step.name} ${result}`)
  }
  logger.success(
    changes.length
      ? `Configured: ${changes.join(', ')}`
      : 'Configuration up to date',
  )
}

// For `sources sync`, after the pull: the part of provisioning a template
// change needs, printed only when it does something. Starts Dockhand and
// catalog-server if needed (the sync uses them), and points Dockhand at the
// new template lists, so its Templates page shows the new versions.
export const refreshTemplateSources = async () => {
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
  if ((await templateSourcesStep.run()) !== 'unchanged') {
    logger.success('Dockhand lists the new templates')
  }
}

// Deployed stacks only: `update` refreshes the core stack through compose
const updateStackImages = async (dryRun: boolean) => {
  const environment = await getLocalEnvironment()
  const updates = await findContainerUpdates(environment.id)
  if (updates.length === 0) {
    logger.success('All containers up to date')
    return []
  }

  const names = updates.map((update) => update.containerName)
  if (dryRun) {
    logger.info(`Updates available for ${names.join(', ')}`)
    return []
  }

  const results = await updateContainers(
    environment.id,
    updates.map((update) => update.containerId),
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
