import { dockerProvider } from '#cli/providers/docker/index.js'
import type { Provider } from '#cli/providers/types.js'

// Add new providers (ansible) here
export const providers: Provider[] = [dockerProvider]

export const provisionProviders = async () => {
  for (const provider of providers) await provider.provision()
}
