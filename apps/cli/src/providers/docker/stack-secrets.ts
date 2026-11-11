import { resolveInside } from '#cli/core/paths.js'
import { SOURCES_DIR } from '#cli/sources/sources.js'
import { tryReadSourceManifest } from '#services/dashboard/source-manifest.js'
import { composeVariables } from '#services/dashboard/templates.js'
import { logger } from '#cli/utils/logger.js'
import { dockhandApi, dockhandPut } from '#cli/providers/docker/api.js'
import {
  ensureSessions,
  readSecrets,
  resolveSecret,
  sourceSecrets,
  type WantedSecret,
} from '#cli/logins/prepare.js'

// The secrets of a Docker stack, from the vault: the variables of its
// template's compose file that the `secrets` of the template's source name.
// local-env reads them with the user's session (logins/prepare.ts, as for the
// roles) and writes them to the stack as Dockhand's secret variables:
// encrypted in its database, given to compose through the environment, never
// in the stack's .env. Dockhand uses them again on a restart or an update
// (docs/3-how-it-works/logins.md).

// <source>/<folder> -> <source>
const sourceOf = (template: string) => template.split('/')[0] ?? ''

// The variables of the stack's compose file that its template's source gives
// from its vault: the names of its `secrets`, as written (resolveSecret says
// when one is not valid)
export const stackSecretNames = (template: string, compose: string) => {
  const manifest = tryReadSourceManifest(
    resolveInside(SOURCES_DIR, sourceOf(template)),
  )
  const declared = new Set(Object.keys(manifest?.secrets ?? {}))
  return composeVariables(compose).filter((name) => declared.has(name))
}

export type StackSecrets = { stack: string; template: string; names: string[] }

// The value of each secret of these stacks, by stack then name: their logins
// made ready (and logged in with the terminal), then read. Throws an Error
// that lists every problem before anything is deployed.
export const readStackSecrets = async (stacks: StackSecrets[]) => {
  const secretsOf = sourceSecrets()
  const problems: string[] = []
  const wanted = new Map<string, WantedSecret[]>()
  for (const { stack, template, names } of stacks) {
    const consumer = { label: stack, source: sourceOf(template) }
    const secrets = names.flatMap((name) => {
      const found = resolveSecret(consumer, name, secretsOf, problems)
      return found ? [found] : []
    })
    if (secrets.length > 0) wanted.set(stack, secrets)
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  if (wanted.size === 0) return new Map<string, Record<string, string>>()

  await ensureSessions(
    [...wanted.values()].flat().map(({ type, login, consumer }) => ({
      type,
      login,
      needs: [consumer.label],
    })),
  )
  const values = new Map<string, Record<string, string>>()
  for (const [stack, secrets] of wanted) {
    values.set(stack, await readSecrets(secrets, stack))
  }
  return values
}

type StackVariable = { key: string; value: string; isSecret: boolean }

// Writes these values to the stack as secret variables, and keeps its other
// variables as they are: Dockhand gives a secret back as ***, and keeps its
// value when it gets *** again
export const writeStackSecrets = async (
  environmentId: number,
  stack: string,
  values: Record<string, string>,
) => {
  const path = `/stacks/${encodeURIComponent(stack)}/env?env=${environmentId}`
  const { variables } = await dockhandApi<{ variables: StackVariable[] }>(path)
  const others = variables.filter(({ key }) => !(key in values))
  const result = await dockhandPut<{ success?: boolean; error?: string }>(
    path,
    {
      variables: [
        ...others,
        ...Object.entries(values).map(([key, value]) => ({
          key,
          value,
          isSecret: true,
        })),
      ],
    },
  )
  if (result.success === false) {
    throw new Error(result.error ?? 'Dockhand did not save the secrets')
  }
}

// The secrets of the stack that Dockhand does not have yet: a stack deployed
// from Dockhand's own page, or before its source gave them
export const missingStackSecrets = async (
  environmentId: number,
  stack: string,
  names: string[],
) => {
  const { variables } = await dockhandApi<{ variables: StackVariable[] }>(
    `/stacks/${encodeURIComponent(stack)}/env?env=${environmentId}`,
  )
  const known = new Set(variables.map(({ key }) => key))
  return names.filter((name) => !known.has(name))
}

// Says which secrets a stack got, never their values
export const reportStackSecrets = (stack: string, names: string[]) =>
  logger.success(
    `${stack}: ${names.length === 1 ? 'its secret' : `${names.length} secrets`} from the vault, saved in Dockhand (${names.join(', ')})`,
  )
