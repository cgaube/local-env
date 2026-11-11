import { mkdirSync } from 'fs'
import {
  type DeployedStack,
  readDeployedStacks,
  type Role,
  writeDeployedStacks,
} from '#services/dashboard/tools.js'
import { wantedStacks } from '#services/dashboard/role-graph.js'
import { TOOLS_DIR } from '#cli/core/tools.js'
import { logger } from '#cli/utils/logger.js'
import { runStep } from '#cli/utils/task.js'
import { askConfirm, askPassword, askText, canAsk } from '#cli/utils/prompt.js'
import { dockhandApi, dockhandPost } from '#cli/providers/docker/api.js'
import { getLocalEnvironment } from '#cli/providers/docker/environments.js'
import { registryLoginsStep } from '#cli/logins/registry.js'
import { readBuildTree } from '#cli/providers/docker/stack-builds.js'
import {
  readStackSecrets,
  stackSecretNames,
} from '#cli/providers/docker/stack-secrets.js'
import {
  composeName,
  hashTemplate,
  readLinks,
  saveSnapshot,
  writeLinks,
} from '#cli/providers/docker/template-link.js'
import {
  readTemplateContent,
  resolveTemplateCompose,
} from '#cli/providers/docker/template-sync.js'

// The stacks that wanted roles need (local-env.yml, `stacks:`), deployed by
// `local-env install` through Dockhand, as if from its Templates page. Each is
// deployed once, linked to its template: `update` and `sources sync` keep it
// up to date like any other. One the user removed since isn't deployed again
// (volumes/tools/stacks.json).

export type StackVariable = { key: string; value: string; isSecret: boolean }

export type StackToDeploy = {
  // <source>/<folder>
  template: string
  // The role that needs it, by id
  by: string
  // The Dockhand stack: the compose `name:`, else the folder
  name: string
  // As catalog-server serves it: what the link compares with
  compose: string
  // The git tree hashes of its build folders, or null when it builds nothing
  build: string | null
  variables: StackVariable[]
}

export type StackPlan = { environmentId: number; stacks: StackToDeploy[] }

// ${NAME:?message} and ${NAME?message}: compose stops without them. Others
// have a default, or are empty when unset.
const REQUIRED = /\$\{([A-Za-z_][A-Za-z0-9_]*):?\?([^}]*)\}/g

export const requiredVariables = (compose: string) => {
  const found = new Map<string, string>()
  for (const [, key = '', help = ''] of compose.matchAll(REQUIRED)) {
    if (!found.has(key)) found.set(key, help.trim())
  }
  return [...found].map(([key, help]) => ({ key, help }))
}

// Typed masked, and kept by Dockhand as a secret, not in the stack's .env
const SECRET = /TOKEN|SECRET|PASSWORD|PASSWD|KEY/i

const saveDeployed = (stacks: Record<string, DeployedStack>) => {
  mkdirSync(TOOLS_DIR, { recursive: true })
  writeDeployedStacks(TOOLS_DIR, stacks)
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

const listStackNames = async (environmentId: number) =>
  new Set(
    (await dockhandApi<{ name: string }[]>(`/stacks?env=${environmentId}`)).map(
      ({ name }) => name,
    ),
  )

// Asks for the variables the stack can't start without, but those its source
// gives from its vault. null when one is left empty, or can't be asked: the
// stack isn't deployed.
const askVariables = async (
  name: string,
  compose: string,
  fromVault: string[],
): Promise<StackVariable[] | null> => {
  const variables: StackVariable[] = []
  for (const { key, help } of requiredVariables(compose)) {
    if (fromVault.includes(key)) continue
    if (!canAsk()) {
      logger.warn(
        `${name} needs ${key}: not deployed. Run local-env install in a terminal to set it.`,
      )
      return null
    }
    const isSecret = SECRET.test(key)
    const message = `${name}: ${key}${help ? ` (${help})` : ''}`
    const value = isSecret
      ? await askPassword(message)
      : await askText(message, '')
    if (!value) {
      logger.warn(`${name}: no ${key}, not deployed`)
      return null
    }
    variables.push({ key, value, isSecret })
  }
  return variables
}

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

  const candidates: Omit<StackToDeploy, 'variables'>[] = []
  for (const { stack: template, by } of wanted) {
    const path = resolveTemplateCompose(template)
    if (!path) {
      logger.warn(
        `${names.get(by) ?? by} needs the ${template} stack, which no source has.`,
      )
      continue
    }
    const compose = readTemplateContent(template, path)
    const [, folder = template] = template.split('/')
    candidates.push({
      template,
      by,
      name: composeName(compose) ?? folder,
      compose,
      build: await readBuildTree(template),
    })
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

  // Deployed already, by hand or from Dockhand's Templates page: never again
  const now = new Date().toISOString()
  const present = candidates.filter(({ name }) => existing.has(name))
  for (const { template, name, by } of present) {
    deployed[template] = { stack: name, by, deployedAt: now }
  }
  if (present.length > 0) saveDeployed(deployed)
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

  // Their private images pull with the logins of their source's registries
  await registryLoginsStep.run()

  // Their secrets from the vault: the logins made ready (asked now, like the
  // rest), the values read, before anything is deployed
  const fromVault = new Map(
    missing.map(({ name, template, compose }) => [
      name,
      stackSecretNames(template, compose),
    ]),
  )
  const secrets = await readStackSecrets(
    missing.map(({ name, template }) => ({
      stack: name,
      template,
      names: fromVault.get(name) ?? [],
    })),
  )

  const stacks: StackToDeploy[] = []
  for (const candidate of missing) {
    const variables = await askVariables(
      candidate.name,
      candidate.compose,
      fromVault.get(candidate.name) ?? [],
    )
    if (!variables) continue
    stacks.push({
      ...candidate,
      variables: [
        ...variables,
        ...Object.entries(secrets.get(candidate.name) ?? {}).map(
          ([key, value]) => ({ key, value, isSecret: true }),
        ),
      ],
    })
  }
  return stacks.length > 0 ? { environmentId, stacks } : null
}

// Deploys the plan, after the tools install. A stack that fails is said, the
// others still deploy. The names deployed.
export const deployRequiredStacks = async ({
  environmentId,
  stacks,
}: StackPlan) => {
  // Dockhand's create replaces a stack of the same name: one created since
  // the plan is left alone
  let existing: Set<string>
  try {
    existing = await listStackNames(environmentId)
  } catch {
    // The tools are installed: only the stacks wait
    logger.warn(
      `Dockhand doesn't answer: ${stacks.map(({ name }) => name).join(', ')} not deployed. Run local-env start, then local-env install.`,
    )
    return []
  }
  const done: string[] = []
  logger.group('Stacks')
  for (const stack of stacks) {
    if (existing.has(stack.name)) {
      logger.warn(
        `${stack.name}: a stack of this name exists now, not deployed`,
      )
      continue
    }
    try {
      // Dockhand pulls the images, builds and starts it before it answers
      const result = await runStep(
        `Deploying ${stack.name}: pulling images and starting it`,
        () =>
          dockhandPost<{ success?: boolean; error?: string }>(
            `/stacks?env=${environmentId}`,
            {
              name: stack.name,
              compose: stack.compose,
              start: true,
              pull: true,
              build: stack.build !== null,
              envVars: stack.variables,
            },
          ),
      )
      if (result.success === false) throw new Error(result.error ?? 'failed')
    } catch (error) {
      logger.warn(
        `${stack.name}: not deployed: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    // Linked to its template from the start: updates merge from this version
    saveSnapshot(stack.template, stack.compose)
    const links = readLinks()
    links[stack.name] = {
      template: stack.template,
      base: hashTemplate(stack.compose),
      how: 'name',
      ...(stack.build ? { build: stack.build } : {}),
    }
    writeLinks(links)
    const deployed = readDeployedStacks(TOOLS_DIR)
    deployed[stack.template] = {
      stack: stack.name,
      by: stack.by,
      deployedAt: new Date().toISOString(),
    }
    saveDeployed(deployed)
    done.push(stack.name)
    logger.success(`${stack.name} deployed`)
  }
  return done
}
