import { dockhandApi } from '#cli/providers/docker/api.js'
import type { DockhandStep } from '#cli/providers/docker/types.js'

// Our sources' templates are deployed from the dashboard (local-env deploy),
// not from Dockhand's Templates page, which can't give them their secrets or
// their links: local-env no longer lists them there, and hides the page
// (steps/sidebar.ts). catalog-server still serves them, at these addresses,
// which local-env registered in Dockhand before.
const CATALOG_URLS = [
  'http://catalog-server:8080',
  'http://templates-server:8080',
]

type TemplateSource = {
  id: number
  name: string
  url: string
  enabled: boolean
  builtin: boolean
}

const getSources = () => dockhandApi<TemplateSource[]>('/templates/sources')

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

// The template lists of our sources that local-env registered in Dockhand
export const ownTemplateSourcesStep: DockhandStep = {
  name: 'Template sources',
  run: async () => {
    const own = (await getSources()).filter((source) =>
      CATALOG_URLS.some((url) => source.url.startsWith(`${url}/`)),
    )

    for (const source of own) {
      await dockhandApi(`/templates/sources?id=${source.id}`, {
        method: 'DELETE',
      })
    }

    return own.length > 0 ? 'updated' : 'unchanged'
  },
}
