import { dockhandApi, dockhandPost } from '../api.js'
import type { DockhandStep } from '../types.js'

// Dockhand warns that it has no login and listens beyond localhost. It only
// sees its own bind address (0.0.0.0, the proxy needs it), not that compose
// publishes it on 127.0.0.1 only (compose.yaml), so the warning doesn't
// apply here.
export const exposureWarningStep: DockhandStep = {
  name: 'Exposure warning (published on localhost only)',
  run: async () => {
    const { warn, dismissed } = await dockhandApi<{
      warn: boolean
      dismissed: boolean
    }>('/exposure-status')
    if (!warn || dismissed) return 'unchanged'
    await dockhandPost('/exposure-status', {})
    return 'updated'
  },
}
