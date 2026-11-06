import { useLiveData } from '#ui/features/live-data/live-data-provider'
import {
  catalogRows,
  currentProfile,
  waitingTools,
} from '#ui/features/tools/tools.ts'

// What the next `local-env install` changes: the tools it installs or
// updates, and the unpicked ones it forgets (it never uninstalls them). The
// Install button and the Tools item of the sidebar count them.
export const useToolChanges = () => {
  const { tools } = useLiveData()
  if (!tools) {
    return {
      waiting: [],
      pending: [],
      unpicked: [],
      sudo: [],
      profile: null,
      count: 0,
    }
  }
  const waiting = waitingTools(tools)
  // The tools, without the profiles: what the user counts
  const pending = waiting.filter((tool) => !tool.isProfile)
  const unpicked = catalogRows(tools).filter(
    (tool) => tool.status === 'unpicked' && !tool.isProfile,
  )
  return {
    // Profiles included: their own tasks run
    waiting,
    pending,
    unpicked,
    // Everything that runs with sudo, the profile's own tasks included
    sudo: waiting.filter((tool) => tool.needsSudo).map(({ label }) => label),
    profile: currentProfile(tools),
    // A profile whose own tasks changed counts as one
    count: Math.max(pending.length, waiting.length) + unpicked.length,
  }
}
