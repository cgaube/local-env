// The Docker page's catalog: what the dashboard streams about each template
// (templates.ts lists them) and the parsing of compose variables, shared by
// the dashboard, the CLI and the web app. No imports: the web app loads it
// too.

export type CatalogTemplate = {
  // <source>/<folder>
  id: string
  source: string
  folder: string
  title: string
  description: string
  logo: string | null
  categories: string[]
  // The Dockhand stack it deploys: its compose `name:`, else the folder
  name: string
  // What a deploy asks for: ${NAME:?help} without a value from the vault
  variables: { key: string; help: string }[]
  // What a deploy reads from the vault: the source's `secrets` it uses
  secrets: string[]
  // Those that Dockhand shows in clear in its pages (unmaskedSecrets)
  unmasked: string[]
  // The registries of its private images: the source's registry logins
  registries: string[]
  // Its VIRTUAL_HOST values, as written: a short one gets the domain
  // (appUrls)
  hosts: string[]
}

// The addresses of an app, as proxy-connector serves them: mail ->
// https://mail.<domain>, a full hostname as is
export const appUrls = (hosts: string[], domain: string) =>
  hosts.map(
    (host) => `https://${host.includes('.') ? host : `${host}.${domain}`}`,
  )

// A stack in Dockhand: its name and its state (running, stopped, partial…)
export type DockhandStack = { name: string; status: string }

// The stacks topic of the dashboard's /api/events: the stacks in Dockhand, or
// not available when Dockhand doesn't answer
export type StacksResponse =
  | { available: true; stacks: DockhandStack[] }
  | { available: false }

// A variable of a compose file: ${NAME}, ${NAME:-x}, ${NAME?msg} or $NAME.
// Not $$NAME, which compose writes as a $.
const VARIABLE =
  /(?<!\$)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g

// A block scalar's header: `key: |`, `- >-`. Its lines are text, not YAML.
const BLOCK_SCALAR = /^\s*(?:-\s+|[^#]*?:\s+)?[|>][1-9+-]*\s*$/

// The compose file without its YAML comments, which compose does not
// interpolate: a # at the start of a line or after a space, outside quotes and
// block scalars. The lines stay where they are.
const withoutComments = (compose: string) => {
  let quote: string | null = null
  let blockIndent: number | null = null
  return compose
    .split('\n')
    .map((line) => {
      const indent = line.length - line.trimStart().length
      if (blockIndent !== null) {
        if (line.trim() === '' || indent > blockIndent) return line
        blockIndent = null
      }
      let end = line.length
      for (let i = 0; i < line.length; i++) {
        const char = line[i]!
        const before = i === 0 ? ' ' : line[i - 1]!
        if (quote === "'") {
          if (char === "'" && line[i + 1] === "'") i++
          else if (char === "'") quote = null
        } else if (quote === '"') {
          if (char === '\\') i++
          else if (char === '"') quote = null
        } else if (char === '#' && /\s/.test(before)) {
          end = i
          break
        } else if ((char === '"' || char === "'") && /[\s[{,:]/.test(before)) {
          quote = char
        }
      }
      const code = line.slice(0, end)
      if (quote === null && BLOCK_SCALAR.test(code)) blockIndent = indent
      return code
    })
    .join('\n')
}

export const composeVariables = (compose: string) => [
  ...new Set(
    [...withoutComments(compose).matchAll(VARIABLE)].map(
      ([, braced, bare]) => braced ?? bare!,
    ),
  ),
]

// ${NAME:?message} and ${NAME?message}: compose stops without them. Others
// have a default, or are empty when unset.
const REQUIRED = /\$\{([A-Za-z_][A-Za-z0-9_]*):?\?([^}]*)\}/g

export const requiredVariables = (compose: string) => {
  const found = new Map<string, string>()
  for (const [, key = '', help = ''] of withoutComments(compose).matchAll(
    REQUIRED,
  )) {
    if (!found.has(key)) found.set(key, help.trim())
  }
  return [...found].map(([key, help]) => ({ key, help }))
}

const LIST_ITEM = /^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)=/
const MAP_KEY = /^\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:/
const BRACED = /\$\{([A-Za-z_][A-Za-z0-9_]*)/g

// The secrets of a compose file that Dockhand shows in clear in its pages (a
// container's Compose and Environment tabs). It hides a container variable
// named like a secret of the stack (SMTP_PASSWORD: ${SMTP_PASSWORD}), or one
// that the list form maps to one (- SMTP_PASS=${SMTP_PASSWORD}): not
// SMTP_PASS: ${SMTP_PASSWORD}, nor a secret in a command or a label. Line by
// line, as Dockhand reads it.
export const unmaskedSecrets = (compose: string, secrets: string[]) => {
  const found = new Set<string>()
  for (const code of withoutComments(compose).split('\n')) {
    const used = composeVariables(code).filter((name) => secrets.includes(name))
    if (used.length === 0) continue
    const item = LIST_ITEM.exec(code)?.[1]
    const masked = item
      ? new Set([item, ...[...code.matchAll(BRACED)].map(([, name]) => name)])
      : new Set([MAP_KEY.exec(code)?.[1]])
    for (const name of used) if (!masked.has(name)) found.add(name)
  }
  return [...found]
}
