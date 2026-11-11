import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type CatalogTemplate,
  composeVariables,
  requiredVariables,
  unmaskedSecrets,
} from './catalog.js'
import { tryReadSourceManifest } from './source-manifest.js'

export {
  appUrls,
  type CatalogTemplate,
  composeVariables,
  type DockhandStack,
  requiredVariables,
  type StacksResponse,
  unmaskedSecrets,
} from './catalog.js'

// The Docker templates of every source, as the dashboard's catalog (the
// Docker page) and `local-env deploy` list them. Shared by the dashboard
// (server.ts) and the CLI, which see the same folders:
//   <sources>/<source>/docker/templates.json   -> the Portainer list
//   <sources>/<source>/docker/<folder>/compose.yaml
// A template's id is <source>/<folder>: only stack entries (type 3) whose
// stackfile is in the source's docker/ folder are templates here.

const COMPOSE_FILES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseYaml = (text: string): unknown => {
  try {
    return Bun.YAML.parse(text)
  } catch {
    return null
  }
}

// The compose `name:`, unless it is a variable
export const composeName = (compose: string) => {
  const parsed = parseYaml(compose)
  const name = isRecord(parsed) ? parsed.name : undefined
  return typeof name === 'string' && !name.startsWith('${') ? name : null
}

const composeImages = (compose: string) => {
  const parsed = parseYaml(compose)
  const services = isRecord(parsed) ? parsed.services : null
  if (!isRecord(services)) return []
  return Object.values(services).flatMap((service) =>
    isRecord(service) && typeof service.image === 'string'
      ? [service.image]
      : [],
  )
}

// The VIRTUAL_HOST values of its services, from an environment mapping or
// list. A value with a variable is left out: compose fills it in.
export const composeHosts = (compose: string) => {
  const parsed = parseYaml(compose)
  const services = isRecord(parsed) ? parsed.services : null
  if (!isRecord(services)) return []
  const values = Object.values(services).flatMap((service) => {
    const environment = isRecord(service) ? service.environment : null
    if (Array.isArray(environment)) {
      return environment.flatMap((item) =>
        typeof item === 'string' && item.startsWith('VIRTUAL_HOST=')
          ? [item.slice('VIRTUAL_HOST='.length)]
          : [],
      )
    }
    const value = isRecord(environment) ? environment.VIRTUAL_HOST : null
    return typeof value === 'string' ? [value] : []
  })
  return [
    ...new Set(
      values
        .flatMap((value) => value.split(','))
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host && !host.includes('$')),
    ),
  ]
}

// docker/<folder>/compose.yaml -> <folder>; null for any other path
const folderOf = (stackfile: string) => {
  const [docker, folder, file, ...rest] = stackfile.split('/')
  return docker === 'docker' &&
    folder &&
    !folder.startsWith('.') &&
    file &&
    rest.length === 0
    ? folder
    : null
}

// The stack entries of a source's templates.json
const readEntries = (dir: string) => {
  try {
    const list = JSON.parse(
      readFileSync(join(dir, 'docker/templates.json'), 'utf8'),
    ) as unknown
    const templates = isRecord(list) ? list.templates : null
    return Array.isArray(templates) ? templates.filter(isRecord) : []
  } catch {
    return []
  }
}

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

// The hosts of the source's registry logins that its images pull from
const registriesOf = (logins: Record<string, unknown>, images: string[]) =>
  [
    ...new Set(
      Object.values(logins).flatMap((login) =>
        isRecord(login) &&
        login.type === 'registry' &&
        typeof login.host === 'string' &&
        images.some((image) => image.startsWith(`${login.host}/`))
          ? [login.host]
          : [],
      ),
    ),
  ].toSorted()

const listSourceTemplates = (
  sourcesDir: string,
  source: string,
): CatalogTemplate[] => {
  const dir = join(sourcesDir, source)
  const manifest = tryReadSourceManifest(dir)
  const declared = new Set(Object.keys(manifest?.secrets ?? {}))
  const seen = new Set<string>()
  return readEntries(dir).flatMap((entry) => {
    const repository = isRecord(entry.repository) ? entry.repository : null
    const folder =
      entry.type === 3 && typeof repository?.stackfile === 'string'
        ? folderOf(repository.stackfile)
        : null
    if (!folder || seen.has(folder)) return []
    const file = COMPOSE_FILES.map((name) =>
      join(dir, 'docker', folder, name),
    ).find((path) => existsSync(path))
    if (!file) return []
    seen.add(folder)
    const compose = readFileSync(file, 'utf8')
    const secrets = composeVariables(compose).filter((name) =>
      declared.has(name),
    )
    return [
      {
        id: `${source}/${folder}`,
        source,
        folder,
        title: typeof entry.title === 'string' ? entry.title : folder,
        description:
          typeof entry.description === 'string' ? entry.description : '',
        logo: typeof entry.logo === 'string' && entry.logo ? entry.logo : null,
        categories: strings(entry.categories),
        name: composeName(compose) ?? folder,
        variables: requiredVariables(compose).filter(
          ({ key }) => !secrets.includes(key),
        ),
        secrets,
        unmasked: unmaskedSecrets(compose, secrets),
        registries: registriesOf(
          manifest?.logins ?? {},
          composeImages(compose),
        ),
        hosts: composeHosts(compose),
      },
    ]
  })
}

// Every source's templates, by source then as listed
export const listTemplates = (sourcesDir: string): CatalogTemplate[] => {
  if (!existsSync(sourcesDir)) return []
  return readdirSync(sourcesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(({ name }) => name)
    .toSorted()
    .flatMap((source) => listSourceTemplates(sourcesDir, source))
}
