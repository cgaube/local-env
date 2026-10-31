import { dockhandPost } from './api.js'

type UpdateCheck = {
  results: {
    containerId: string
    containerName: string
    hasUpdate: boolean
    // Dockhand itself; it updates through its own self-update
    systemContainer: string | null
    // dockhand.update=false, e.g. images built locally
    updateDisabled: boolean
  }[]
}

type BatchUpdate = {
  results: {
    containerName: string
    success: boolean
    error?: string
  }[]
}

// Same check as Dockhand's scheduled auto-update: compares each container's
// image digest with the registry
export const findContainerUpdates = async (environmentId: number) => {
  const { results } = await dockhandPost<UpdateCheck>(
    `/containers/check-updates?env=${environmentId}`,
    {},
  )
  return results.filter(
    (result) =>
      result.hasUpdate && !result.systemContainer && !result.updateDisabled,
  )
}

// Pulls the new image and recreates each container with its current config
export const updateContainers = async (
  environmentId: number,
  containerIds: string[],
) => {
  const { results } = await dockhandPost<BatchUpdate>(
    `/containers/batch-update?env=${environmentId}`,
    { containerIds },
  )
  return results
}
