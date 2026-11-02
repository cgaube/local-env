import { useQuery } from '@tanstack/react-query'

// The configured domain (dev.test), for the examples. undefined while it
// loads: they read fine without it.
export const useDomain = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const response = await fetch('/api/config')
      if (!response.ok) throw new Error(`/api/config: ${response.status}`)
      return (await response.json()) as { domain: string }
    },
    staleTime: Infinity,
    select: (config) => config.domain,
  }).data
