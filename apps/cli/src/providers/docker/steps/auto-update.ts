import { dockhandApi, dockhandPost } from '../api.js'
import { getLocalEnvironment } from '../environments.js'
import type { DockhandStep } from '../types.js'

// Weekdays at 10:00 and 14:00: laptops are usually asleep at Dockhand's 04:00
const UPDATE_CRON = '0 10,14 * * 1-5'

type UpdateCheckSettings = {
  enabled: boolean
  cron: string
  autoUpdate: boolean
}

// Pulls newer images and recreates containers whose tag moved (latest, 16, ...)
export const autoUpdateStep: DockhandStep = {
  name: 'Container auto-update (Local environment)',
  run: async () => {
    const local = await getLocalEnvironment()
    const path = `/environments/${local.id}/update-check`
    const { settings } = await dockhandApi<{ settings: UpdateCheckSettings }>(
      path,
    )

    if (
      settings.enabled &&
      settings.autoUpdate &&
      settings.cron === UPDATE_CRON
    ) {
      return 'unchanged'
    }

    await dockhandPost(path, {
      ...settings,
      enabled: true,
      autoUpdate: true,
      cron: UPDATE_CRON,
    })

    return 'updated'
  },
}
