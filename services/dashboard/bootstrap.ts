// The bootstrap of a source: the roles its manifest lists in `bootstrap:`,
// which make the Mac ready for its logins (a CLI, an AWS profile, a VPN).
// They run before the logins, so they get no secret, name no login and need
// no stack: a bootstrap can't need what it makes
// (docs/3-how-it-works/source-bootstrap.md). Shared by the dashboard
// (server.ts: the Overview shows them, the Tools page hides them) and the
// CLI (apps/cli/src/core/bootstrap.ts runs them). This file only reads, and
// writes bootstrap.json for the CLI.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wantedRoles } from './role-graph.js'
import { tryReadSourceManifest } from './source-manifest.js'
import type { Role } from './tools.js'

// In the tools folder: by source, the revision that ran, and when
export const BOOTSTRAP_FILE = 'bootstrap.json'

export type BootstrapState = Record<string, { revision: string; ranAt: string }>

export type BootstrapPlan = {
  source: string
  // The roles the manifest lists, as found
  roles: Role[]
  // Them and every role they include: what Ansible runs
  run: Role[]
  // A hash of the files of the roles of the run and of the values of their
  // inputs: a change runs the bootstrap again
  revision: string
  // What stops it: a role that no source has, or one that needs a login
  problems: string[]
}

// What the dashboard gets of a bootstrap
export type BootstrapStatus = {
  source: string
  // The ids of the roles the manifest lists, and of every role they include
  roles: string[]
  run: string[]
  // done: ran with this revision; never: never ran; changed: ran with other
  // roles or values; blocked: can't run (problems)
  state: 'done' | 'never' | 'changed' | 'blocked'
  problems: string[]
}

// A role as `bootstrap` names it: of the source first, then of any source,
// as Ansible finds a dependency
const findRole = (catalog: Role[], source: string, name: string) => {
  const named = catalog.filter((role) => role.name === name)
  return named.find((role) => role.source === source) ?? named[0]
}

// What a role of the run needs that a bootstrap can't have
const roleProblems = (role: Role, root: Role): string[] => {
  const via = role.id === root.id ? '' : ` (included by ${root.label})`
  const problems: string[] = []
  if (role.secrets.length > 0) {
    problems.push(
      `${role.label}${via} gets secrets (${role.secrets.join(', ')}): a bootstrap runs before the logins, so it can't read a vault. Move the role out of bootstrap, or the secret out of the role.`,
    )
  }
  if (role.logins.length > 0) {
    problems.push(
      `${role.label}${via} names logins (${role.logins.join(', ')}): a bootstrap runs before the logins. It can set one up (a CLI, a profile), not use it.`,
    )
  }
  if (role.stacks.length > 0) {
    problems.push(
      `${role.label}${via} needs stacks (${role.stacks.join(', ')}): a bootstrap deploys none.`,
    )
  }
  return problems
}

// The revision of a run: the files of its roles (each role's revision is a
// hash of its folder) and the values its inputs get from variables.json. A
// secret never gets one there.
const revisionOf = (run: Role[], values: Record<string, unknown>) => {
  const lines = [...run]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, revision }) => `${id}@${revision}`)
  const names = new Set(
    run.flatMap(({ inputs, secrets }) =>
      inputs
        .filter(({ secret, name }) => !secret && !secrets.includes(name))
        .map(({ name }) => name),
    ),
  )
  for (const name of [...names].sort()) {
    if (values[name] !== undefined) {
      lines.push(`${name}=${JSON.stringify(values[name])}`)
    }
  }
  return createHash('sha256')
    .update(lines.join('\n'))
    .digest('hex')
    .slice(0, 12)
}

// The bootstrap of this source with these roles listed, or null when it has
// none. `values`: the saved values of the inputs (variables.json).
export const planBootstrap = (
  catalog: Role[],
  source: string,
  names: string[],
  values: Record<string, unknown> = {},
): BootstrapPlan | null => {
  if (names.length === 0) return null
  const problems: string[] = []
  const roles: Role[] = []
  for (const name of names) {
    const role = findRole(catalog, source, name)
    if (role) roles.push(role)
    else {
      problems.push(
        `bootstrap names ${name}, a role that no source has (its source has ansible/<folder>/ or ansible/<collection>/roles/<role>/).`,
      )
    }
  }
  const byId = new Map(catalog.map((role) => [role.id, role]))
  const run: Role[] = []
  const seen = new Set<string>()
  for (const root of roles) {
    for (const id of wantedRoles(catalog, [root.id])) {
      const role = byId.get(id)!
      problems.push(...roleProblems(role, root))
      if (seen.has(id)) continue
      seen.add(id)
      run.push(role)
    }
  }
  return {
    source,
    roles,
    run,
    revision: revisionOf(run, values),
    problems: [...new Set(problems)],
  }
}

// The bootstraps of the sources in this folder (each a git clone) that have
// one. A manifest that is not valid has none: `doctor` says so.
export const listBootstrapPlans = (
  sourcesDir: string,
  catalog: Role[],
  values: Record<string, unknown>,
) =>
  (existsSync(sourcesDir)
    ? readdirSync(sourcesDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            existsSync(join(sourcesDir, entry.name, '.git')),
        )
        .map((entry) => entry.name)
        .sort()
    : []
  ).flatMap(
    (source) =>
      planBootstrap(
        catalog,
        source,
        tryReadSourceManifest(join(sourcesDir, source))?.bootstrap ?? [],
        values,
      ) ?? [],
  )

export const readBootstrapState = (toolsDir: string): BootstrapState => {
  try {
    const state = JSON.parse(
      readFileSync(join(toolsDir, BOOTSTRAP_FILE), 'utf8'),
    )
    return typeof state === 'object' && state !== null && !Array.isArray(state)
      ? state
      : {}
  } catch {
    return {}
  }
}

export const writeBootstrapState = (toolsDir: string, state: BootstrapState) =>
  writeFileSync(
    join(toolsDir, BOOTSTRAP_FILE),
    `${JSON.stringify(state, null, 2)}\n`,
  )

// Where each bootstrap stands, for the dashboard
export const bootstrapStatuses = (
  plans: BootstrapPlan[],
  state: BootstrapState,
): BootstrapStatus[] =>
  plans.map((plan) => ({
    source: plan.source,
    roles: plan.roles.map(({ id }) => id),
    run: plan.run.map(({ id }) => id),
    state:
      plan.problems.length > 0
        ? 'blocked'
        : !(plan.source in state)
          ? 'never'
          : state[plan.source]!.revision === plan.revision
            ? 'done'
            : 'changed',
    problems: plan.problems,
  }))
