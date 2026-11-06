import { dockhandApi, dockhandPost } from '#cli/providers/docker/api.js'
import type { DockhandStep } from '#cli/providers/docker/types.js'

// The pages local-env users rarely need: the CLI and the dashboard handle
// registries, updates and the rest. They stay one click away, in Dockhand's
// sidebar settings.
export const HIDDEN_SIDEBAR_ITEMS = [
  '/activity',
  '/registry',
  '/schedules',
  '/images',
  '/volumes',
  '/networks',
]

type SidebarPreferences = { order: string[]; hidden: string[] }

// Without a login, Dockhand keeps one sidebar for everyone. Set only while
// it is untouched (Dockhand's default), so a user's own choice is kept.
export const sidebarStep: DockhandStep = {
  name: 'Sidebar',
  run: async () => {
    const { preferences } = await dockhandApi<{
      preferences: SidebarPreferences
    }>('/preferences/sidebar')

    if (preferences.order.length > 0 || preferences.hidden.length > 0) {
      return 'unchanged'
    }

    await dockhandPost('/preferences/sidebar', {
      // Empty: Dockhand's own order, new pages included
      order: [],
      hidden: HIDDEN_SIDEBAR_ITEMS,
    })

    return 'updated'
  },
}
