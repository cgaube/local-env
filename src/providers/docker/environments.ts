import { dockhandApi } from './api.js'

export type Environment = {
  id: number
  name: string
  connectionType: string
}

export const getEnvironments = () => dockhandApi<Environment[]>('/environments')

// The Local environment is the one using the Docker socket
export const getLocalEnvironment = async () => {
  const local = (await getEnvironments()).find(
    (env) => env.connectionType === 'socket',
  )
  if (!local) {
    throw new Error(
      'No Local socket environment found. Run `local-env start` first.',
    )
  }
  return local
}
