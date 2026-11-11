import { mkdirSync } from 'fs'
import {
  readDeployedStacks,
  type Role,
  writeDeployedStacks,
} from '#services/dashboard/tools.js'
import { wantedStacks } from '#services/dashboard/role-graph.js'
import { TOOLS_DIR } from '#cli/core/tools.js'
import { logger } from '#cli/utils/logger.js'
import { askConfirm, canAsk } from '#cli/utils/prompt.js'
import { getLocalEnvironment } from '#cli/providers/docker/environments.js'
import {
  listStackNames,
  prepareStacks,
  readCandidate,
  type StackCandidate,
  type StackPlan,
} from '#cli/providers/docker/stack-deploy.js'

// The stacks that wanted roles need (local-env.yml, `stacks:`), deployed by
// `local-env install` through Dockhand (stack-deploy.ts), like
// `local-env deploy` does for one template. Each is deployed once: one the
// user removed since isn't deployed again (volumes/tools/stacks.json).

const RETRY = 'local-env install'

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

// What to deploy, asked before the tools install: the user answers once, then
// the run goes on alone. null when there is nothing to deploy.
export const planRequiredStacks = async (
  catalog: Role[],
  roots: Role[],
  { yes = false }: { yes?: boolean } = {},
): Promise<StackPlan | null> => {
  const deployed = readDeployedStacks(TOOLS_DIR)
  const names = new Map(catalog.map(({ id, label }) => [id, label]))
  const wanted = wantedStacks(
    catalog,
    roots.map(({ id }) => id),
  ).filter(({ stack }) => !deployed[stack])
  if (wanted.length === 0) return null

  const candidates: StackCandidate[] = []
  for (const { stack: template, by } of wanted) {
    const candidate = await readCandidate(template, by)
    if (!candidate) {
      logger.warn(
        `${names.get(by) ?? by} needs the ${template} stack, which no source has.`,
      )
      continue
    }
    candidates.push(candidate)
  }
  if (candidates.length === 0) return null

  let environmentId: number
  let existing: Set<string>
  try {
    environmentId = (await getLocalEnvironment()).id
    existing = await listStackNames(environmentId)
  } catch {
    logger.warn(
      `Your tools need ${candidates.map(({ name }) => name).join(', ')}, but Dockhand doesn't answer: run local-env start, then local-env install to deploy them.`,
    )
    return null
  }

  // Deployed already, by hand or with local-env deploy: never again
  const now = new Date().toISOString()
  const present = candidates.filter(({ name }) => existing.has(name))
  for (const { template, name, by = '' } of present) {
    deployed[template] = { stack: name, by, deployedAt: now }
  }
  if (present.length > 0) {
    mkdirSync(TOOLS_DIR, { recursive: true })
    writeDeployedStacks(TOOLS_DIR, deployed)
  }
  const missing = candidates.filter(({ name }) => !existing.has(name))
  if (missing.length === 0) return null

  const list = missing.map(({ name }) => name).join(', ')
  if (!yes) {
    if (!canAsk()) {
      logger.info(
        `Your tools need ${list}, not deployed yet. Run local-env install in a terminal, or with --yes.`,
      )
      return null
    }
    if (
      !(await askConfirm(
        `Your tools need ${plural(missing.length, 'stack')} (${list}). Deploy ${missing.length === 1 ? 'it' : 'them'} in Docker?`,
        true,
      ))
    ) {
      logger.info(`${list}: not deployed. local-env install asks again.`)
      return null
    }
  }

  return prepareStacks(environmentId, missing, RETRY)
}
