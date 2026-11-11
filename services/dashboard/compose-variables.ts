// The variables of a compose file: those a stack uses, those a deploy asks
// for, and the secrets Dockhand shows in clear. Shared by the dashboard
// (templates.ts) and the CLI. Not by the web app: it parses with Bun.YAML.

// A variable of a compose file: ${NAME}, ${NAME:-x}, ${NAME?msg} or $NAME.
// Not $$NAME, which compose writes as a $.
const VARIABLE =
  /(?<!\$)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g

// The strings of a compose file, where compose interpolates: the values of
// its YAML, so not its comments. None for a file that isn't valid YAML, which
// Dockhand refuses anyway.
const composeStrings = (compose: string) => {
  const strings: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') strings.push(value)
    else if (value && typeof value === 'object')
      Object.values(value).forEach(walk)
  }
  try {
    walk(Bun.YAML.parse(compose))
  } catch {
    return []
  }
  return strings
}

const variablesIn = (text: string) => [
  ...new Set(
    [...text.matchAll(VARIABLE)].map(([, braced, bare]) => braced ?? bare!),
  ),
]

export const composeVariables = (compose: string) =>
  variablesIn(composeStrings(compose).join('\n'))

// ${NAME:?message} and ${NAME?message}: compose stops without them. Others
// have a default, or are empty when unset.
const REQUIRED = /\$\{([A-Za-z_][A-Za-z0-9_]*):?\?([^}]*)\}/g

export const requiredVariables = (compose: string) => {
  const found = new Map<string, string>()
  const strings = composeStrings(compose).join('\n')
  for (const [, key = '', help = ''] of strings.matchAll(REQUIRED)) {
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
// line, as Dockhand reads it, among the secrets the YAML uses.
export const unmaskedSecrets = (compose: string, secrets: string[]) => {
  const used = new Set(
    composeVariables(compose).filter((name) => secrets.includes(name)),
  )
  const found = new Set<string>()
  for (const line of compose.split('\n')) {
    const code = line.replace(/(^|\s)#.*$/, '')
    const names = variablesIn(code).filter((name) => used.has(name))
    if (names.length === 0) continue
    const item = LIST_ITEM.exec(code)?.[1]
    const masked = item
      ? new Set([item, ...[...code.matchAll(BRACED)].map(([, name]) => name)])
      : new Set([MAP_KEY.exec(code)?.[1]])
    for (const name of names) if (!masked.has(name)) found.add(name)
  }
  return [...found]
}
