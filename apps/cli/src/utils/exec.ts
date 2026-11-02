import { execa } from 'execa'
import { readConfig } from '../core/config.js'
import { COMPOSE_FILE } from '../core/paths.js'
import {
  listBuiltServices,
  readRevisions,
  revisionVariable,
} from '../core/revisions.js'
import { runTask } from './task.js'

export const execDocker = async (args: string[], { capture = false } = {}) => {
  return execa('docker', args, {
    stdio: capture ? 'pipe' : 'inherit',
  })
}

// compose.yaml reads its settings from these variables
const composeEnv = () => {
  const { domain, buildPort } = readConfig()
  return {
    LOCAL_ENV_DOMAIN: domain,
    LOCAL_ENV_BUILD_PORT: String(buildPort),
    ...readRevisions(),
  }
}

// Always targets the home folder's compose file, whatever the current directory
export const execCompose = async (args: string[], { capture = false } = {}) => {
  return execa('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    stdio: capture ? 'pipe' : 'inherit',
    env: composeEnv(),
  })
}

// Same, with the output folded into a clack task log. Before `up`, rebuilds
// the core images whose code changed: `up` recreates their containers anyway
// (their revision label changed), and would otherwise reuse the old image.
export const runCompose = async (
  title: string,
  args: string[],
  options?: { done?: string },
) => {
  if (args[0] === 'up') await buildChangedServices()
  return runTask(title, 'docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    ...options,
    env: composeEnv(),
  })
}

// Built core services whose container runs another revision of their code
const buildChangedServices = async () => {
  const revisions = readRevisions()
  const { stdout } = await execCompose(['ps', '--all', '--format', 'json'], {
    capture: true,
  })
  const deployed = new Map(
    (stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row) as { Service: string; Labels: string })
      .map(({ Service, Labels }) => [
        Service,
        /(?:^|,)local-env\.revision=([^,]*)/.exec(Labels)?.[1],
      ]),
  )
  const changed = listBuiltServices()
    .filter(
      ({ service, folder }) =>
        deployed.get(service) !== revisions[revisionVariable(folder)],
    )
    .map(({ service }) => service)
  if (changed.length === 0) return
  await runTask(
    `Rebuilding ${changed.join(', ')}`,
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'build', ...changed],
    { done: `Rebuilt ${changed.join(', ')}`, env: composeEnv() },
  )
}

export const isDockerRunning = async () => {
  try {
    await execa('docker', ['info'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
