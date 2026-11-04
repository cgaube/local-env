import { dockhandPost } from '#cli/providers/docker/api.js'
import { getEnvironments } from '#cli/providers/docker/environments.js'
import type { DockhandStep } from '#cli/providers/docker/types.js'

export const localEnvironmentStep: DockhandStep = {
  name: 'Local environment (docker socket)',
  run: async () => {
    const environments = await getEnvironments()

    if (environments.some((env) => env.connectionType === 'socket')) {
      return 'unchanged'
    }

    await dockhandPost('/environments', {
      name: 'Local',
      connectionType: 'socket',
      socketPath: '/var/run/docker.sock',
    })

    return 'created'
  },
}
