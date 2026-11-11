import { mkdirSync } from 'fs'
import {
  readDeployedStacks,
  writeDeployedStacks,
} from '#services/dashboard/tools.js'
import {
  composeName,
  requiredVariables,
} from '#services/dashboard/templates.js'
import { TOOLS_DIR } from '#cli/core/tools.js'
import { logger } from '#cli/utils/logger.js'
import { runStep } from '#cli/utils/task.js'
import { askPassword, askText, canAsk } from '#cli/utils/prompt.js'
import { dockhandApi, dockhandPost } from '#cli/providers/docker/api.js'
import { registryLoginsStep } from '#cli/logins/registry.js'
import { readBuildTree } from '#cli/providers/docker/stack-builds.js'
import {
  readStackSecrets,
  stackSecretNames,
  warnUnmaskedSecrets,
} from '#cli/providers/docker/stack-secrets.js'
import {
  hashTemplate,
  readLinks,
  saveSnapshot,
  writeLinks,
} from '#cli/providers/docker/template-link.js'
import {
  readTemplateContent,
  resolveTemplateCompose,
} from '#cli/providers/docker/template-sync.js'

// Deploys stacks from their templates through Dockhand, for
// `local-env deploy` (one template, from the catalog) and `local-env install`
// (the stacks the wanted roles need, required-stacks.ts). Before anything is
// deployed: the registry logins of the source, the secrets from the vault and
// the variables the user must give. Each stack is linked to its template from
// the start, so `update` and `sources sync` keep it up to date.

export type StackVariable = { key: string; value: string; isSecret: boolean }

export type StackCandidate = {
  // <source>/<folder>
  template: string
  // The role that needs it, by id: install records it in stacks.json, so a
  // stack the user removed since isn't deployed again
  by?: string
  // The Dockhand stack: the compose `name:`, else the folder
  name: string
  // As catalog-server serves it: what the link compares with
  compose: string
  // The git tree hashes of its build folders, or null when it builds nothing
  build: string | null
}

export type StackToDeploy = StackCandidate & { variables: StackVariable[] }

export type StackPlan = { environmentId: number; stacks: StackToDeploy[] }

// The template's compose file, as served, or null when no source has it
export const readCandidate = async (
  template: string,
  by?: string,
): Promise<StackCandidate | null> => {
  const path = resolveTemplateCompose(template)
  if (!path) return null
  const compose = readTemplateContent(template, path)
  const [, folder = template] = template.split('/')
  return {
    template,
    ...(by ? { by } : {}),
    name: composeName(compose) ?? folder,
    compose,
    build: await readBuildTree(template),
  }
}

export const listStackNames = async (environmentId: number) =>
  new Set(
    (await dockhandApi<{ name: string }[]>(`/stacks?env=${environmentId}`)).map(
      ({ name }) => name,
    ),
  )

// Typed masked, and kept by Dockhand as a secret, not in the stack's .env
const SECRET = /TOKEN|SECRET|PASSWORD|PASSWD|KEY/i

// Asks for the variables the stack can't start without, but those its source
// gives from its vault. null when one is left empty, or can't be asked: the
// stack isn't deployed.
const askVariables = async (
  name: string,
  compose: string,
  fromVault: string[],
  retry: string,
): Promise<StackVariable[] | null> => {
  const variables: StackVariable[] = []
  for (const { key, help } of requiredVariables(compose)) {
    if (fromVault.includes(key)) continue
    if (!canAsk()) {
      logger.warn(
        `${name} needs ${key}: not deployed. Run ${retry} in a terminal to set it.`,
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

// Everything the stacks need before they deploy: the registry logins of
// their sources, their secrets from the vault (the logins made ready and
// read, or an Error that lists every problem) and the variables the user
// gives. null when none is left to deploy. `retry` is the command to run
// again, in the messages.
export const prepareStacks = async (
  environmentId: number,
  candidates: StackCandidate[],
  retry: string,
): Promise<StackPlan | null> => {
  // Their private images pull with the logins of their source's registries
  await registryLoginsStep.run()

  const fromVault = new Map(
    candidates.map(({ name, template, compose }) => [
      name,
      stackSecretNames(template, compose),
    ]),
  )
  for (const { name, compose } of candidates) {
    warnUnmaskedSecrets(name, compose, fromVault.get(name) ?? [])
  }
  const secrets = await readStackSecrets(
    candidates.map(({ name, template }) => ({
      stack: name,
      template,
      names: fromVault.get(name) ?? [],
    })),
  )

  const stacks: StackToDeploy[] = []
  for (const candidate of candidates) {
    const variables = await askVariables(
      candidate.name,
      candidate.compose,
      fromVault.get(candidate.name) ?? [],
      retry,
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

// Deploys the plan. A stack that fails is said, the others still deploy. The
// names deployed.
export const deployStacks = async (
  { environmentId, stacks }: StackPlan,
  retry: string,
) => {
  // Dockhand's create replaces a stack of the same name: one created since
  // the plan is left alone
  let existing: Set<string>
  try {
    existing = await listStackNames(environmentId)
  } catch {
    logger.warn(
      `Dockhand doesn't answer: ${stacks.map(({ name }) => name).join(', ')} not deployed. Run local-env start, then ${retry}.`,
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
    if (stack.by) {
      mkdirSync(TOOLS_DIR, { recursive: true })
      const deployed = readDeployedStacks(TOOLS_DIR)
      deployed[stack.template] = {
        stack: stack.name,
        by: stack.by,
        deployedAt: new Date().toISOString(),
      }
      writeDeployedStacks(TOOLS_DIR, deployed)
    }
    done.push(stack.name)
    logger.success(`${stack.name} deployed`)
  }
  return done
}
