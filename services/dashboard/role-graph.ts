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
  // The variables it passes to each dependency (`vars:` of the entry, or
  // its role parameters), in the order of dependencies
  dependencyVars?: Record<string, unknown>[]
  // Stack templates it needs, as <source>/<folder>
  stacks: string[]
  // The Galaxy collections its collection needs (galaxy.yml), by name: a
  // dependency in one of them is a Galaxy role, installed by local-env
  galaxy?: Record<string, string>
  // The values it takes (meta/argument_specs.yml)
  inputs?: RoleInput[]
}

// A value a role takes: an option of the `main` entry point of its
// meta/argument_specs.yml, Ansible's own format. Ansible checks it before the
// role runs.
export type RoleInput = {
  // The variable: Ansible's extra vars are global, so a value is per name
  name: string
  // Ansible's type: str, int, bool, float, list, dict, path, raw…
  type: string
  // Required and without a default: the role fails without a value
  required: boolean
  // Shown as the placeholder. Ansible does not apply it: the role's
  // defaults/main.yml does. Absent without one.
  default?: unknown
  choices: (string | number | boolean)[] | null
  description: string | null
  // no_log: never shown, asked or saved
  secret: boolean
}

// A role of a Galaxy collection, read once `local-env install` installed it
// (volumes/tools/collections)
export type GalaxyRole = {
  // <namespace>.<collection>.<role>
  name: string
  // By full name
  dependencies: string[]
  // The variables it passes to each, in the same order
  dependencyVars?: Record<string, unknown>[]
  inputs: RoleInput[]
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

// An input of the wanted roles, with the roles that declare it, by label (a
// Galaxy role by its name). Of two declarations, the first gives the type,
// the choices, the description and the default; it is required when one of
// them requires it, and secret when one of them is.
export type WantedInput = RoleInput & {
  roles: string[]
  // The roles that pass it to a role that declares it, in their dependency
  // entry (meta/main.yml)
  setBy: string[]
  // One of them runs: its owner chose the value, which wins over the
  // user's. Never asked or passed; the form shows it disabled.
  provided: boolean
  // That value, as written in the dependency entry: a template stays text
  given?: unknown
  // Two roles declare it with another type or other choices: one value
  // still goes to both, as Ansible's variables are global
  conflict: boolean
}

// The Galaxy roles the wanted roles include, and those they include: by
// name, once installed
const wantedGalaxyRoles = (
  roles: GraphRole[],
  roots: string[],
  galaxyRoles: GalaxyRole[],
) => {
  const byName = new Map(galaxyRoles.map((role) => [role.name, role]))
  const found: GalaxyRole[] = []
  const seen = new Set<string>()
  const queue = externalRoles(roles, roots)
    .filter(({ kind }) => kind === 'galaxy')
    .map(({ name }) => name)
  for (let name = queue.shift(); name; name = queue.shift()) {
    if (seen.has(name)) continue
    seen.add(name)
    const role = byName.get(name)
    if (!role) continue
    found.push(role)
    queue.push(...role.dependencies)
  }
  return found
}

// A role that runs, a role of a source by its id or a Galaxy role by its
// name, and the variables that each role including it passes (`vars:`). A
// root is included once more, with none.
type RunNode = {
  label: string
  inputs: RoleInput[]
  includedWith: { by: string | null; vars: Record<string, unknown> }[]
}

const runNodes = (
  roles: GraphRole[],
  roots: string[],
  galaxyRoles: GalaxyRole[],
) => {
  const resolve = resolver(roles)
  const wanted = wantedRoles(roles, roots)
  // The roots the playbook names: a pick that the profile includes runs
  // inside it, not once more on its own
  const named = new Set(playbookRoots(roles, roots))
  const nodes = new Map<string, RunNode>()
  for (const role of roles.filter(({ id }) => wanted.has(id))) {
    nodes.set(role.id, {
      label: role.label,
      inputs: role.inputs ?? [],
      includedWith: named.has(role.id) ? [{ by: null, vars: {} }] : [],
    })
  }
  const galaxy = wantedGalaxyRoles(roles, roots, galaxyRoles)
  for (const role of galaxy) {
    nodes.set(role.name, {
      label: role.name,
      inputs: role.inputs,
      includedWith: [],
    })
  }
  const include = (key: string, by: string, vars: Record<string, unknown>) =>
    nodes.get(key)?.includedWith.push({ by, vars })
  for (const role of roles.filter(({ id }) => wanted.has(id))) {
    role.dependencies.forEach((name, index) => {
      const vars = role.dependencyVars?.[index] ?? {}
      const found = resolve(role, name)
      if (found.length > 0) {
        for (const dependency of found) include(dependency.id, role.label, vars)
      } else {
        // A Galaxy role: a short name is a role of its collection
        include(
          role.collection && !name.includes('.')
            ? `${role.collection}.${name}`
            : name,
          role.label,
          vars,
        )
      }
    })
  }
  for (const role of galaxy) {
    role.dependencies.forEach((name, index) =>
      include(name, role.name, role.dependencyVars?.[index] ?? {}),
    )
  }
  return [...nodes.values()]
}

// The inputs of the wanted roles, each name once, in the order of the roles.
// A variable that a role which runs passes to the role declaring it (`vars:`
// of the dependency entry) is set by that role: not asked or passed.
export const wantedInputs = (
  roles: GraphRole[],
  roots: string[],
  galaxyRoles: GalaxyRole[] = [],
): WantedInput[] => {
  const inputs = new Map<string, WantedInput>()
  for (const { label, inputs: own, includedWith } of runNodes(
    roles,
    roots,
    galaxyRoles,
  )) {
    for (const input of own) {
      const setters = includedWith.filter(({ vars }) => input.name in vars)
      // A role that runs sets it for this one: its owner chose the value, so
      // it wins over the user's
      const provided = setters.length > 0
      const setBy = setters.flatMap(({ by }) => (by ? [by] : []))
      const required = input.required && !provided
      const known = inputs.get(input.name)
      if (!known) {
        inputs.set(input.name, {
          ...input,
          required,
          roles: [label],
          setBy,
          provided,
          conflict: false,
          ...(provided ? { given: setters[0]!.vars[input.name] } : {}),
        })
        continue
      }
      inputs.set(input.name, {
        ...known,
        ...(known.default === undefined && input.default !== undefined
          ? { default: input.default }
          : {}),
        required: known.required || required,
        secret: known.secret || input.secret,
        roles: known.roles.includes(label)
          ? known.roles
          : [...known.roles, label],
        setBy: [...new Set([...known.setBy, ...setBy])],
        provided: known.provided || provided,
        ...(known.provided
          ? {}
          : provided
            ? { given: setters[0]!.vars[input.name] }
            : {}),
        conflict:
          known.conflict ||
          known.type !== input.type ||
          JSON.stringify(known.choices) !== JSON.stringify(input.choices),
      })
    }
  }
  return [...inputs.values()]
}

// The inputs the user sets: no secret, and not given by the roles that
// include them
export const userInputs = (inputs: WantedInput[]) =>
  inputs.filter((input) => !input.secret && !input.provided)

// The saved values the install passes to Ansible (extra vars): only those of
// the inputs the user sets, so a value given by a parent role stays
export const passedValues = (
  inputs: WantedInput[],
  values: Record<string, unknown>,
) =>
  Object.fromEntries(
    userInputs(inputs)
      .filter(({ name }) => name in values)
      .map(({ name }) => [name, values[name]] as const),
  )

// What the dashboard and the CLI save for an input: a value of its type, or
// of its choices. A list is a JSON array and a dict a JSON object: Ansible
// checks that the text "a,b" can be a list, but the role still gets the
// text.
export const isInputValue = (input: RoleInput, value: unknown) => {
  if (value === null || value === undefined) return false
  if (input.choices) return input.choices.some((choice) => choice === value)
  switch (input.type) {
    case 'bool':
      return typeof value === 'boolean'
    case 'int':
      return Number.isInteger(value)
    case 'float':
      return typeof value === 'number' && Number.isFinite(value)
    case 'str':
    case 'path':
      return typeof value === 'string'
    case 'list':
      return Array.isArray(value)
    case 'dict':
      return typeof value === 'object' && !Array.isArray(value)
    default:
      return true
  }
}

// A value as text, for a text field: a list as "a, b", a dict as JSON
export const inputText = (input: RoleInput, value: unknown) =>
  value === undefined
    ? ''
    : input.type === 'list' && Array.isArray(value)
      ? value.map(String).join(', ')
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)

// The value of a text typed for an input, or why it is refused. Empty is
// no value. A list is split at the commas; a dict is a JSON object.
export const parseInputText = (
  input: RoleInput,
  text: string,
): { value: unknown } | { error: string } => {
  if (text.trim() === '') return { value: undefined }
  switch (input.type) {
    case 'int':
    case 'float': {
      const number = Number(text)
      return (
        input.type === 'int'
          ? Number.isInteger(number)
          : Number.isFinite(number)
      )
        ? { value: number }
        : {
            error:
              input.type === 'int' ? 'Type a whole number.' : 'Type a number.',
          }
    }
    case 'list':
      return {
        value: text
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      }
    case 'dict': {
      try {
        const value: unknown = JSON.parse(text)
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          return { value }
        }
      } catch {
        // Not JSON
      }
      return { error: 'Type a JSON object: {"key": "value"}.' }
    }
    default:
      return { value: text }
  }
}

// The required inputs with no saved value: the install asks for them. Not
// the secrets, which local-env does not support yet.
export const missingInputs = (
  inputs: WantedInput[],
  values: Record<string, unknown>,
) =>
  inputs.filter(
    (input) =>
      input.required &&
      !input.secret &&
      !input.provided &&
      !(input.name in values),
  )

// The required secrets: local-env can't give them, so the role fails
export const unsupportedSecrets = (inputs: WantedInput[]) =>
  inputs.filter((input) => input.required && input.secret)

// The values passed of a role's own inputs (passedValues), by name in
// order: recorded in installed.json. A change makes the role changed.
export const roleValues = (
  role: Pick<GraphRole, 'inputs'>,
  values: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    (role.inputs ?? [])
      .filter((input) => !input.secret && input.name in values)
      .map(({ name }) => [name, values[name]] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )

// Whether a role's values differ from the ones its last install got
export const valuesChanged = (
  role: Pick<GraphRole, 'inputs'>,
  values: Record<string, unknown>,
  installed: Record<string, unknown> | undefined,
) => {
  const sorted = (map: Record<string, unknown>) =>
    JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
  return sorted(roleValues(role, values)) !== sorted(installed ?? {})
}
