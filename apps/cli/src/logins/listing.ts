import { listSources } from '#cli/sources/sources.js'
import {
  type DockhandRegistry,
  readSourceRegistries,
  registryLoginLine,
} from '#cli/logins/registry.js'

// The logins of the sources as the commands show them: a line each

// The sources that declare a login of any type
export const sourcesWithAnyLogin = () =>
  listSources().filter((source) => readSourceRegistries(source).length > 0)

// A line for each login of the source. `registries` is undefined when
// Dockhand can't be reached.
export const sourceLoginLines = async (
  source: string,
  registries: DockhandRegistry[] | undefined,
) =>
  readSourceRegistries(source).map((login) =>
    registryLoginLine(source, login, registries),
  )
