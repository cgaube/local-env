import {
  includedRoles,
  titleize,
  wantedRoles,
} from '#services/dashboard/role-graph.ts'
import type { Role, Tools } from '#ui/features/live-data/live-data.ts'

// Where a tool stands on this Mac:
// - to-install: wanted, never installed
// - update: installed, its role changed since
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
  { installed }: Tools,
  wanted: Set<string>,
  role: Role,
): ToolStatus | null => {
  const install = installed[role.id]
  if (!install) return wanted.has(role.id) ? 'to-install' : null
  if (!wanted.has(role.id)) return 'unpicked'
  return install.revision === role.revision ? 'installed' : 'update'
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
  // When `local-env install` last ran it, as an ISO date
  installedAt: string | null
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

// Every role, profiles included, and the picks whose role left the sources:
// listed so they can be unpicked (`local-env install` unpicks them too)
export const catalogRows = (tools: Tools): CatalogRow[] => {
  const profile = currentProfile(tools)
  const roots = [...tools.picked, ...(profile ? [profile.id] : [])]
  const included = includedRoles(tools.roles, tools.picked)
  const inProfile = profile
    ? new Set([profile.id, ...includedRoles(tools.roles, [profile.id]).keys()])
    : new Set<string>()
  // Picked, in the profile, or included by those: `local-env install`
  // installs it
  const wanted = wantedRoles(tools.roles, roots)
  const known = new Set(tools.roles.map((role) => role.id))
  return [
    ...tools.roles.map((role) => ({
      ...role,
      installedAt: tools.installed[role.id]?.installedAt ?? null,
      picked: tools.picked.includes(role.id),
      includedBy: included.get(role.id) ?? [],
      inProfile: inProfile.has(role.id) ? (profile?.label ?? null) : null,
      status: statusOf(tools, wanted, role),
    })),
    ...tools.picked
      .filter((id) => !known.has(id))
      .map((id) => {
        // Its id is its path: <source>/<folder> (readSelection)
        const [source = '', ...rest] = id.split('/')
        const folder = rest.join('/')
        const name = folder.split('/').at(-1) ?? folder
        return {
          id,
          source,
          folder,
          name,
          collection: null,
          label: titleize(name),
          description: null,
          tags: [],
          dependencies: [],
          isProfile: false,
          stacks: [],
          revision: '',
          needsSudo: false,
          installedAt: tools.installed[id]?.installedAt ?? null,
          picked: true,
          includedBy: [],
          inProfile: null,
          status: 'removed' as const,
        }
      }),
  ]
}

// Writes the playbook `local-env install` runs (services/dashboard/server.ts)
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
