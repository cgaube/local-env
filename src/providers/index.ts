import { dockerProvider } from './docker/index.js'
import type { Provider } from './types.js'

// Add new providers (ansible) here
export const providers: Provider[] = [dockerProvider]

export const provisionProviders = async () => {
  for (const provider of providers) await provider.provision()
}
