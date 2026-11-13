import { mkdirSync } from 'fs'
import type { Role } from '#services/dashboard/tools.js'
import {
  type BootstrapState,
  readBootstrapState,
  writeBootstrapState,
} from '#services/dashboard/bootstrap.js'
import {
  type BootstrapPlan,
  describeRoles,
  listBootstraps,
} from '#cli/core/bootstrap-plan.js'
import { listCatalog, runPlaybook, TOOLS_DIR } from '#cli/core/tools.js'
import { sourceLabel } from '#cli/sources/sources.js'
import { hasCommand } from '#cli/utils/brew.js'
import { logger } from '#cli/utils/logger.js'
import { askConfirm, canAsk } from '#cli/utils/prompt.js'

// Runs the bootstraps of the sources (bootstrap-plan.ts) through the install's
// pipeline: one playbook of their roles, the sudo password on Ansible's
// stdin, the output drawn like an install. A bootstrap runs when it never
// ran, or when its roles changed (their hash, kept by source in
// volumes/tools/bootstrap.json once a run succeeds; the values of their inputs
// are part of the hash)
// (docs/3-how-it-works/source-bootstrap.md).

export const BOOTSTRAP_COMMAND = 'local-env sources bootstrap'

const readState = () => readBootstrapState(TOOLS_DIR)

const writeState = (state: BootstrapState) => {
  mkdirSync(TOOLS_DIR, { recursive: true })
  writeBootstrapState(TOOLS_DIR, state)
}

export type PendingBootstrap = BootstrapPlan & {
  // It ran before, with other roles
  changed: boolean
}

// The bootstraps that never ran, or whose roles changed since they ran. Of
// these sources only, when given.
export const pendingBootstraps = (
  catalog: Role[],
  sources?: string[],
): PendingBootstrap[] => {
  const state = readState()
  return listBootstraps(catalog)
    .filter(({ source }) => !sources || sources.includes(source))
    .filter(({ source, revision }) => state[source]?.revision !== revision)
    .map((plan) => ({ ...plan, changed: plan.source in state }))
}

const labelOf = (source: string) => sourceLabel(source) ?? source

// "the bootstrap of Acme (Granted, VPN client)"
const describe = (plan: BootstrapPlan) =>
  `the bootstrap of ${labelOf(plan.source)} (${describeRoles(plan)})`

// Runs these bootstraps, as one playbook, then records them. Throws when one
// can't run (a role missing, one that needs a login) or Ansible fails.
export const runBootstraps = async (
  catalog: Role[],
  plans: BootstrapPlan[],
  { verbose = false }: { verbose?: boolean } = {},
) => {
  if (plans.length === 0) return
  logger.group('Bootstrap')
  const problems = plans.flatMap(({ source, problems }) =>
    problems.map((problem) => `${source}: ${problem}`),
  )
  if (problems.length > 0) throw new Error(problems.join('\n'))
  if (!(await hasCommand('ansible-playbook'))) {
    throw new Error(
      'Ansible is not installed. Run `local-env setup`, or `brew install ansible`.',
    )
  }
  logger.info(`Runs ${plans.map(describe).join(', ')}`)
  const roots = [
    ...new Map(
      plans.flatMap(({ roles }) => roles).map((role) => [role.id, role]),
    ).values(),
  ]
  await runPlaybook(catalog, roots, { verbose })
  const ranAt = new Date().toISOString()
  const state = readState()
  // Hashed again: the run saved the values it asked for, which are part of
  // the revision
  const ran = new Map(
    listBootstraps(catalog).map(({ source, revision }) => [source, revision]),
  )
  for (const { source, revision } of plans) {
    state[source] = { revision: ran.get(source) ?? revision, ranAt }
  }
  writeState(state)
  logger.success(
    plans.length === 1
      ? `Bootstrapped ${labelOf(plans[0]!.source)}`
      : `Bootstrapped ${plans.map(({ source }) => labelOf(source)).join(', ')}`,
  )
}

// Before what needs a bootstrap done (`install`, `login`): runs the ones that
// never ran or changed, without asking. Throws when one can't run.
export const ensureBootstraps = async (
  options: { verbose?: boolean; catalog?: Role[] } = {},
) => {
  const catalog = options.catalog ?? listCatalog()
  await runBootstraps(catalog, pendingBootstraps(catalog), options)
}

// After the sources changed: asks to run the bootstraps that never ran or
// changed (`sources add`), or only those that changed since they ran
// (`changedOnly`: `sync` and `update`, which don't ask again for one
// declined at `sources add`). --yes runs them. Without a terminal, says what
// to run. One that can't run is said, not run: the caller goes on. `install`
// and `login` run them anyway.
export const offerBootstraps = async (
  options: { yes?: boolean; sources?: string[]; changedOnly?: boolean } = {},
) => {
  const catalog = listCatalog()
  const pending = pendingBootstraps(catalog, options.sources).filter(
    ({ changed }) => changed || !options.changedOnly,
  )
  if (pending.length === 0) return
  const wanted: PendingBootstrap[] = []
  for (const plan of pending) {
    if (plan.problems.length > 0) {
      logger.warn(
        `${labelOf(plan.source)}: its bootstrap can't run.\n${plan.problems.join('\n')}`,
      )
      continue
    }
    const label = labelOf(plan.source)
    const question = plan.changed
      ? `The bootstrap of ${label} changed (${describeRoles(plan)}). Run it again now?`
      : `${label} has a bootstrap (${describeRoles(plan)}). Run it now?`
    if (options.yes) {
      wanted.push(plan)
    } else if (!canAsk()) {
      logger.info(
        `${plan.changed ? `The bootstrap of ${label} changed` : `${label} has a bootstrap`}: run \`${BOOTSTRAP_COMMAND} ${plan.source}\`. \`local-env install\` and \`local-env login\` run it too.`,
      )
    } else if (await askConfirm(question, true)) {
      wanted.push(plan)
    } else {
      logger.info(
        `Skipped: \`local-env install\` and \`local-env login\` run it first, or \`${BOOTSTRAP_COMMAND} ${plan.source}\`.`,
      )
    }
  }
  await runBootstraps(catalog, wanted)
}
