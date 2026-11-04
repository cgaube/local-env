// How roles bring other roles, and the stacks they need. Shared by the
// dashboard's app (apps/web) and the CLI: no import, so the browser can load
// it. A role names its dependencies (meta/main.yml) by name, found in any
// source, as Ansible finds them through ANSIBLE_ROLES_PATH. A profile is a
// role made of others: it is one more root, like a picked role.

export type GraphRole = {
  // <source>/<role>
  id: string
  name: string
  dependencies: string[]
  // Stack templates it needs, as <source>/<folder>
  stacks: string[]
}

// The roles the roots bring with them: their dependencies, and those of their
// dependencies. By id: the names of the roots that include it. A root is
// never included by itself, even through a cycle.
export const includedRoles = (roles: GraphRole[], roots: string[]) => {
  const byName = Map.groupBy(roles, (role) => role.name)
  const included = new Map<string, string[]>()
  for (const root of roles.filter((role) => roots.includes(role.id))) {
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

// The ids of the roots and of the roles they include: what Ansible runs
export const wantedRoles = (roles: GraphRole[], roots: string[]) => {
  const known = new Set(roles.map((role) => role.id))
  return new Set([
    ...roots.filter((id) => known.has(id)),
    ...includedRoles(roles, roots).keys(),
  ])
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
