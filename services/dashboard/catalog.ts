// The Docker page's catalog: what the dashboard streams about each template
// (templates.ts lists them), shared by the dashboard, the CLI and the web app.
// No imports: the web app loads it too.

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
