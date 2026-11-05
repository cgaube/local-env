import {
  type ExternalRole,
  externalRoles,
  wantedRoles,
  wantedStacks,
} from '#services/dashboard/role-graph.ts'
import type { Role, Tools } from '#ui/features/live-data/live-data.ts'

// A profile and what it brings: the tools of its whole tree (the profiles it
// includes too) and the stacks they need
export type ProfileRow = Role & {
  current: boolean
  // Its tools, at every depth, without the profiles among them
  tools: Role[]
  // The roles of its tree that no source has: from Galaxy, installed with
  // it, or missing
  external: ExternalRole[]
  // The profiles it includes, by name
  includes: string[]
  // Not installed on this Mac yet, or changed since
  pending: Role[]
  // The stacks of its whole tree, <source>/<folder>, and whether
  // `local-env install` deployed each
  stackStates: { stack: string; deployed: boolean }[]
}

export const profileRows = (tools: Tools): ProfileRow[] =>
  tools.roles
    .filter((role) => role.isProfile)
    .map((profile) => {
      const tree = wantedRoles(tools.roles, [profile.id])
      const inTree = tools.roles.filter(
        ({ id }) => tree.has(id) && id !== profile.id,
      )
      const own = inTree.filter((role) => !role.isProfile)
      return {
        ...profile,
        current: tools.profile === profile.id,
        tools: own,
        external: externalRoles(tools.roles, [profile.id]),
        includes: inTree
          .filter((role) => role.isProfile)
          .map(({ label }) => label),
        pending: own.filter(
          ({ id, revision }) => tools.installed[id]?.revision !== revision,
        ),
        stackStates: wantedStacks(tools.roles, [profile.id]).map(
          ({ stack }) => ({
            stack,
            deployed: stack in tools.stacks,
          }),
        ),
      }
    })

// Writes profile.json, which `local-env install` reads: an id, or null for
// none
export const saveProfile = async (profile: string | null) => {
  const response = await fetch('/api/tools/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
  if (!response.ok) {
    throw new Error(`Saving the profile failed (${response.status})`)
  }
}
