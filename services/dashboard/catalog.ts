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

// GET /api/stacks of the dashboard: the names of the stacks in Dockhand, or
// not available when Dockhand doesn't answer
export type StacksResponse =
  | { available: true; stacks: string[] }
  | { available: false }

// A variable of a compose file: ${NAME}, ${NAME:-x}, ${NAME?msg} or $NAME.
// Not $$NAME, which compose writes as a $.
const VARIABLE =
  /(?<!\$)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g

export const composeVariables = (compose: string) => [
  ...new Set(
    [...compose.matchAll(VARIABLE)].map(([, braced, bare]) => braced ?? bare!),
  ),
]

// ${NAME:?message} and ${NAME?message}: compose stops without them. Others
// have a default, or are empty when unset.
const REQUIRED = /\$\{([A-Za-z_][A-Za-z0-9_]*):?\?([^}]*)\}/g

export const requiredVariables = (compose: string) => {
  const found = new Map<string, string>()
  for (const [, key = '', help = ''] of compose.matchAll(REQUIRED)) {
    if (!found.has(key)) found.set(key, help.trim())
  }
  return [...found].map(([key, help]) => ({ key, help }))
}
