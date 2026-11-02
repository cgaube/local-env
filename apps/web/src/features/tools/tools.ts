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

// The roles that picked roles bring with them: their dependencies, by name in
// any source as Ansible finds them, and those of their dependencies. A role
// made of others is a profile. By id: the names of the picked roles that
// include it.
export const includedRoles = ({ roles, picked }: Tools) => {
  const byName = Map.groupBy(roles, (role) => role.name)
  const included = new Map<string, string[]>()
  for (const root of roles.filter((role) => picked.includes(role.id))) {
    const seen = new Set([root.id])
    const queue = [root]
    for (let role = queue.shift(); role; role = queue.shift()) {
      for (const dependency of role.dependencies.flatMap(
        (name) => byName.get(name) ?? [],
      )) {
        if (seen.has(dependency.id)) continue
        seen.add(dependency.id)
        queue.push(dependency)
        included.set(dependency.id, [
          ...(included.get(dependency.id) ?? []),
          root.name,
        ])
      }
    }
  }
  return included
}

// Picked, or included by a picked role: `local-env install` installs it
const wantedRoles = (tools: Tools) =>
  new Set([...tools.picked, ...includedRoles(tools).keys()])

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
  status: ToolStatus | null
}

// Every role, and the picks whose role left the sources: listed so they can
// be unpicked (`local-env install` unpicks them too)
export const catalogRows = (tools: Tools): CatalogRow[] => {
  const included = includedRoles(tools)
  const wanted = wantedRoles(tools)
  const known = new Set(tools.roles.map((role) => role.id))
  return [
    ...tools.roles.map((role) => ({
      ...role,
      installedAt: tools.installed[role.id]?.installedAt ?? null,
      picked: tools.picked.includes(role.id),
      includedBy: included.get(role.id) ?? [],
      status: statusOf(tools, wanted, role),
    })),
    ...tools.picked
      .filter((id) => !known.has(id))
      .map((id) => {
        const [source = '', name = id] = id.split('/')
        return {
          id,
          source,
          name,
          description: null,
          tags: [],
          dependencies: [],
          revision: '',
          needsSudo: false,
          installedAt: tools.installed[id]?.installedAt ?? null,
          picked: true,
          includedBy: [],
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
