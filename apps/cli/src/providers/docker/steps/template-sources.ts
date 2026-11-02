import { execa } from 'execa'
import { join } from 'path'
import { dockhandApi, dockhandPost, dockhandPut } from '../api.js'
import { listSources, SOURCES_DIR } from '../../../sources/sources.js'
import type { DockhandStep, DockhandStepResult } from '../types.js'

// Served by the catalog-server compose service: /<name> is the docker/ folder
// of the source cloned in volumes/sources/<name>
const CATALOG_URL = 'http://catalog-server:8080'
// Sources registered by older versions, removed on the next provisioning
const LEGACY_URLS = ['http://templates-server:8080']

type TemplateSource = {
  id: number
  name: string
  url: string
  enabled: boolean
  builtin: boolean
}

const getSources = () => dockhandApi<TemplateSource[]>('/templates/sources')

// The list's address without its ?v= version
const listPath = (url: string) => url.split('?')[0]

const ensureSource = async (
  sources: TemplateSource[],
  name: string,
  url: string,
): Promise<DockhandStepResult> => {
  const existing = sources.find(
    (source) => listPath(source.url) === listPath(url),
  )

  if (!existing) {
    await dockhandPost('/templates/sources', { name, url })
    return 'created'
  }

  if (!existing.enabled || existing.url !== url) {
    await dockhandPut('/templates/sources', {
      id: existing.id,
      enabled: true,
      url,
    })
    return 'updated'
  }

  return 'unchanged'
}

// Dockhand keeps each template list for an hour, by address. The version of
// the source's docker/ folder in the address makes it fetch a changed list
// right away.
const listUrl = async (name: string) => {
  const url = `${CATALOG_URL}/${name}/templates.json`
  const { stdout, exitCode } = await execa(
    'git',
    ['-C', join(SOURCES_DIR, name), 'rev-parse', 'HEAD:docker'],
    { reject: false },
  )
  return exitCode === 0 ? `${url}?v=${stdout.trim().slice(0, 12)}` : url
}

const mergeResults = (results: DockhandStepResult[]): DockhandStepResult => {
  if (results.includes('created')) return 'created'
  if (results.includes('updated')) return 'updated'
  return 'unchanged'
}

// Dockhand adds its built-in catalogs (Lissy93, LinuxServer.io…) only while
// its list of sources is empty: deleted once, they stay deleted, and users
// add the catalogs they want back as their own sources, which local-env
// leaves alone. Turning them off instead would undo the user's choice on
// every start.
export const removeBuiltinTemplatesStep: DockhandStep = {
  name: 'Built-in template sources',
  run: async () => {
    const builtin = (await getSources()).filter((source) => source.builtin)

    for (const source of builtin) {
      await dockhandApi(`/templates/sources?id=${source.id}`, {
        method: 'DELETE',
      })
    }

    return builtin.length > 0 ? 'updated' : 'unchanged'
  },
}

export const templateSourcesStep: DockhandStep = {
  name: 'Template sources',
  run: async () => {
    const desired = await Promise.all(
      listSources().map(async (name) => ({ name, url: await listUrl(name) })),
    )

    const sources = await getSources()
    const results: DockhandStepResult[] = []

    // Drop sources we manage whose repo was removed
    const stale = sources.filter(
      (source) =>
        [CATALOG_URL, ...LEGACY_URLS].some((url) =>
          source.url.startsWith(`${url}/`),
        ) && !desired.some(({ url }) => listPath(url) === listPath(source.url)),
    )
    for (const source of stale) {
      await dockhandApi(`/templates/sources?id=${source.id}`, {
        method: 'DELETE',
      })
      results.push('updated')
    }

    for (const { name, url } of desired) {
      results.push(await ensureSource(sources, name, url))
    }

    return mergeResults(results)
  },
}
