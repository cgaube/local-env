import { useQuery } from '@tanstack/react-query'
import { FORMULA_URL, versionOfFormula } from '#cli/core/homebrew.ts'

const DAY = 24 * 60 * 60 * 1000

// The version the Homebrew formula installs, read from the browser (GitHub
// allows it), once a day at most while the dashboard stays open. null when it
// can't be read: the menu then shows only the running version.
export const useLatestVersion = () =>
  useQuery({
    queryKey: ['latest-version'],
    queryFn: async () => {
      const response = await fetch(FORMULA_URL)
      if (!response.ok) throw new Error(`${FORMULA_URL}: ${response.status}`)
      return versionOfFormula(await response.text())
    },
    staleTime: DAY,
    refetchInterval: DAY,
    retry: false,
  })
