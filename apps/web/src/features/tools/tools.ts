import {
  includedRoles,
  missingInputs,
  passedValues,
  titleize,
  unsupportedSecrets,
  valuesChanged,
  wantedInputs,
  wantedRoles,
} from '#services/dashboard/role-graph.ts'
import type { Role, Tools } from '#ui/features/live-data/live-data.ts'

// Where a tool stands on this Mac:
// - to-install: wanted, never installed
// - update: installed, its role or the values of its inputs changed since
// - installed: installed, up to date
// - unpicked: installed, then unpicked: local-env doesn't uninstall
// - removed: installed, its role left the sources
export type ToolStatus =
  | 'to-install'
  | 'update'
  | 'installed'
  | 'unpicked'
  | 'removed'

const statusOf = (
  tools: Tools,
  wanted: Set<string>,
  // The values the next install passes (passedValues)
  passed: Record<string, unknown>,
  role: Role,
): ToolStatus | null => {
  const install = tools.installed[role.id]
  if (!install) return wanted.has(role.id) ? 'to-install' : null
  if (!wanted.has(role.id)) return 'unpicked'
  return install.revision === role.revision &&
    !valuesChanged(role, passed, install.values)
    ? 'installed'
    : 'update'
}

// What the status filter and the badges say. available: in the catalog,
// neither picked nor installed.
export const STATUS_LABELS: Record<ToolStatus | 'available', string> = {
  'to-install': 'To install',
  update: 'Update available',
  installed: 'Installed',
  unpicked: 'Unpicked, still installed',
  removed: 'Gone from the sources',
  available: 'Not installed',
}

export type CatalogRow = Role & {
  picked: boolean
  // The picked roles that include it: its switch stays on
  includedBy: string[]
  // The name of the profile that includes it: its switch stays on
  inProfile: string | null
  status: ToolStatus | null
}

// A stack of the role's source by its folder, one of another by its id
export const stackName = (stack: string, source: string) =>
  stack.startsWith(`${source}/`) ? stack.slice(source.length + 1) : stack

// The profile, while it is in a source
export const currentProfile = ({ roles, profile }: Tools) =>
  roles.find((role) => role.id === profile && role.isProfile) ?? null

// The roles the sources' bootstraps list: run before the logins, not picked,
// so not in the catalog
const bootstrapRoots = (tools: Tools) =>
  tools.bootstraps.flatMap(({ roles }) => roles)

// Every role, profiles included, and the picks whose role left the sources:
// listed so they can be unpicked (`local-env install` unpicks them too).
// Not the roles the bootstraps list; the roles they include count as wanted,
// so one installed by a bootstrap is not unpicked.
export const catalogRows = (tools: Tools): CatalogRow[] => {
  const profile = currentProfile(tools)
  const hidden = new Set(bootstrapRoots(tools))
  const roots = [...tools.picked, ...(profile ? [profile.id] : []), ...hidden]
  const included = includedRoles(tools.roles, tools.picked)
  const inProfile = profile
    ? new Set([profile.id, ...includedRoles(tools.roles, [profile.id]).keys()])
    : new Set<string>()
  // Picked, in the profile, or included by those: `local-env install`
  // installs it
  const wanted = wantedRoles(tools.roles, roots)
  const passed = passedValues(
    wantedInputs(tools.roles, roots, tools.galaxyRoles),
    tools.variables,
  )
  const known = new Set(tools.roles.map((role) => role.id))
  return [
    ...tools.roles
      .filter((role) => !hidden.has(role.id))
      .map((role) => ({
        ...role,
        picked: tools.picked.includes(role.id),
        includedBy: included.get(role.id) ?? [],
        inProfile: inProfile.has(role.id) ? (profile?.label ?? null) : null,
        status: statusOf(tools, wanted, passed, role),
      })),
    ...tools.picked
      .filter((id) => !known.has(id))
      .map((id) => {
        // Its id: <source>/<name>
        const [source = '', name = id] = id.split('/')
        return {
          id,
          source,
          folder: name,
          name,
          collection: null,
          // The role, without its collection
          label: titleize(name.split('.').at(-1) ?? name),
          description: null,
          tags: [],
          dependencies: [],
          isProfile: false,
          stacks: [],
          revision: '',
          needsSudo: false,
          galaxy: {},
          inputs: [],
          picked: true,
          includedBy: [],
          inProfile: null,
          status: 'removed' as const,
        }
      }),
  ]
}

// The roots `local-env install` runs: the profile and the picks, and the
// bootstraps it runs first
const rootsOf = (tools: Tools) => {
  const profile = currentProfile(tools)
  return [
    ...tools.picked,
    ...(profile ? [profile.id] : []),
    ...bootstrapRoots(tools),
  ]
}

// The inputs of what the next install runs (the profile, the picks, what
// they include, Galaxy roles too), each variable once: the Variables sheet and
// the Install button. Required ones without a value, which the install asks
// for, and required secrets, which local-env can't give yet. unused: the
// saved values that none of them takes, kept for a later profile or pick.
export const toolInputs = (tools: Tools) => {
  const inputs = wantedInputs(tools.roles, rootsOf(tools), tools.galaxyRoles)
  const names = new Set(inputs.map(({ name }) => name))
  return {
    // Not the secrets, unless the vault gives them: local-env never shows a
    // secret's value
    inputs: inputs.filter((input) => !input.secret || input.vault),
    missing: missingInputs(inputs, tools.variables),
    secrets: unsupportedSecrets(inputs),
    unused: unusedValues(tools, names),
  }
}

// The saved values that no wanted role takes, with the role of the catalog
// that declares each, by label (null: none does any more)
const unusedValues = (tools: Tools, used: Set<string>) => {
  const declaredBy = new Map(
    wantedInputs(
      tools.roles,
      tools.roles.map(({ id }) => id),
      tools.galaxyRoles,
    ).map((input) => [input.name, input.roles[0] ?? null]),
  )
  return Object.entries(tools.variables)
    .filter(([name]) => !used.has(name))
    .map(([name, value]) => ({
      name,
      value,
      role: declaredBy.get(name) ?? null,
    }))
}

// Saves the values that change to variables.json (null removes one), which
// `local-env install` passes to Ansible. The server merges them into the
// file as it is: a value the CLI saved meanwhile stays
// (services/dashboard/server.ts).
export const saveVariables = async (changes: Record<string, unknown>) => {
  const response = await fetch('/api/tools/variables', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables: changes }),
  })
  if (!response.ok) {
    throw new Error(`Saving the values failed (${response.status})`)
  }
}

// What waits for `local-env install`: wanted and not installed, or changed
// since. Profiles too: their own tasks run.
export const waitingTools = (tools: Tools) =>
  catalogRows(tools).filter(
    ({ status }) => status === 'to-install' || status === 'update',
  )

// Saves the picks to picked.json, which `local-env install` reads
// (services/dashboard/server.ts)
export const savePickedTools = async (roles: string[]) => {
  const response = await fetch('/api/tools/picked', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles }),
  })
  if (!response.ok) {
    throw new Error(`Saving the picked tools failed (${response.status})`)
  }
}
