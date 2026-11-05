// How roles bring other roles, and the stacks they need. Shared by the
// dashboard's app (apps/web) and the CLI: no import, so the browser can load
// it. A role names its dependencies (meta/main.yml) by name, found in any
// source, as Ansible finds them through ANSIBLE_COLLECTIONS_PATH and
// ANSIBLE_ROLES_PATH: <namespace>.<collection>.<role>, or a plain role's name.
// A role of a collection can name one of its own collection by its short
// name. A profile is a role made of others: it is one more root, like a
// picked role.

// The name to show of a role without a label: its folder name, title-cased
// (git_extras -> Git Extras). Ansible allows only lowercase letters, digits
// and _ there, so brand names (TablePlus) need a label.
export const titleize = (name: string) =>
  name.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export type GraphRole = {
  // <source>/<name>
  id: string
  // <namespace>.<collection>.<role>, or <role> for a plain role
  name: string
  // <namespace>.<collection>, or null for a plain role
  collection: string | null
  // The name to show
  label: string
  dependencies: string[]
  // Stack templates it needs, as <source>/<folder>
  stacks: string[]
  // The Galaxy collections its collection needs (galaxy.yml), by name: a
  // dependency in one of them is a Galaxy role, installed by local-env
  galaxy?: Record<string, string>
}

// Finds a role's dependency, as Ansible looks: the role's own collection
// first, then the name as is
const resolver = (roles: GraphRole[]) => {
  const byName = Map.groupBy(roles, (role) => role.name)
  return (role: GraphRole, name: string) =>
    (role.collection && !name.includes('.')
      ? byName.get(`${role.collection}.${name}`)
      : undefined) ??
    byName.get(name) ??
    []
}

// The roles the roots bring with them: their dependencies, and those of their
// dependencies. By id: the labels of the roots that include it. A root is
// never included by itself, even through a cycle.
export const includedRoles = (roles: GraphRole[], roots: string[]) => {
  const resolve = resolver(roles)
  const included = new Map<string, string[]>()
  for (const root of roles.filter((role) => roots.includes(role.id))) {
    const seen = new Set([root.id])
    const queue = [root]
    for (let role = queue.shift(); role; role = queue.shift()) {
      for (const dependency of role.dependencies.flatMap((name) =>
        resolve(role, name),
      )) {
        if (seen.has(dependency.id)) continue
        seen.add(dependency.id)
        queue.push(dependency)
        included.set(dependency.id, [
          ...(included.get(dependency.id) ?? []),
          root.label,
        ])
      }
    }
  }
  return included
}

// The ids of the roots and of the roles they include: what Ansible runs
export const wantedRoles = (roles: GraphRole[], roots: string[]) => {
  const known = new Set(roles.map((role) => role.id))
  return new Set([
    ...roots.filter((id) => known.has(id)),
    ...includedRoles(roles, roots).keys(),
  ])
}

// A dependency of a wanted role that no source has: a role of a Galaxy
// collection that its collection needs (galaxy.yml), or missing, which
// Ansible stops on unless it is on the Mac already
export type ExternalRole = {
  // <namespace>.<collection>.<role>, or the name as written
  name: string
  // <namespace>.<collection>, for a Galaxy role
  collection: string | null
  kind: 'galaxy' | 'missing'
  // The first wanted role that needs it, by id
  by: string
}

export const externalRoles = (
  roles: GraphRole[],
  roots: string[],
): ExternalRole[] => {
  const resolve = resolver(roles)
  const wanted = wantedRoles(roles, roots)
  const external = new Map<string, ExternalRole>()
  for (const role of roles.filter(({ id }) => wanted.has(id))) {
    for (const dependency of role.dependencies) {
      if (resolve(role, dependency).length > 0) continue
      // A short name is a role of its own collection
      const name =
        role.collection && !dependency.includes('.')
          ? `${role.collection}.${dependency}`
          : dependency
      if (external.has(name)) continue
      const parts = name.split('.')
      const collection = parts.length === 3 ? parts.slice(0, 2).join('.') : null
      const galaxy = collection !== null && collection in (role.galaxy ?? {})
      external.set(name, {
        name,
        collection: galaxy ? collection : null,
        kind: galaxy ? 'galaxy' : 'missing',
        by: role.id,
      })
    }
  }
  return [...external.values()]
}

export type WantedStack = {
  // <source>/<folder>
  stack: string
  // The first wanted role that needs it, by id
  by: string
}

// The stacks the wanted roles need, each once, in the order of the roles
export const wantedStacks = (
  roles: GraphRole[],
  roots: string[],
): WantedStack[] => {
  const wanted = wantedRoles(roles, roots)
  const stacks = new Map<string, string>()
  for (const role of roles.filter(({ id }) => wanted.has(id))) {
    for (const stack of role.stacks) {
      if (!stacks.has(stack)) stacks.set(stack, role.id)
    }
  }
  return [...stacks].map(([stack, by]) => ({ stack, by }))
}

// The roots without the ones another root already includes: a playbook that
// names a role by its path and again as a dependency by its name runs it
// twice. In order; of roots that include each other, the last one stays.
export const playbookRoots = (roles: GraphRole[], roots: string[]) => {
  const dropped = new Set<string>()
  return roots.filter((root) => {
    const others = roots.filter(
      (other) => other !== root && !dropped.has(other),
    )
    if (!wantedRoles(roles, others).has(root)) return true
    dropped.add(root)
    return false
  })
}
