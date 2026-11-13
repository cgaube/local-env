import type { Bootstrap, Tools } from '#ui/features/live-data/live-data.ts'

// The sources' bootstraps (services/dashboard/bootstrap.ts): the roles a
// source runs before its logins. Not in the Tools catalog: the Overview shows
// them, in the panel of their source, and in Needs attention when they wait
// for you.

export type BootstrapRow = Bootstrap & {
  // The roles the manifest lists, by label
  labels: string[]
}

const STATES: Record<Bootstrap['state'], string> = {
  done: 'Done',
  never: 'Never ran',
  changed: 'Changed',
  blocked: "Can't run",
}

export const bootstrapStateLabel = (state: Bootstrap['state']) => STATES[state]

// What to run in a terminal: the dashboard runs it with Install too
export const bootstrapCommand = (source: string) =>
  `local-env sources bootstrap ${source}`

// Each bootstrap with the labels of its roles, by source
export const bootstrapRows = (tools: Tools | null) => {
  const labels = new Map(tools?.roles.map(({ id, label }) => [id, label]))
  return new Map(
    (tools?.bootstraps ?? []).map((bootstrap): [string, BootstrapRow] => [
      bootstrap.source,
      {
        ...bootstrap,
        labels: bootstrap.roles.map((id) => labels.get(id) ?? id),
      },
    ]),
  )
}
