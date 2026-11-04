import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { savePickedTools } from '#ui/features/tools/tools.ts'

// The picked tools, a switch flipping as soon as it is clicked: the event
// stream sends the saved playbook back a moment later. The flipped list holds
// until then, while the stream's list is still the one it started from.
export const usePickedTools = (picked: string[]) => {
  const [optimistic, setOptimistic] = useState<{
    from: string[]
    roles: string[]
  } | null>(null)
  const save = useMutation({
    mutationFn: savePickedTools,
    onError: () => setOptimistic(null),
  })
  const shown =
    optimistic && optimistic.from === picked ? optimistic.roles : picked

  const setPicked = (id: string, on: boolean) => {
    const roles = on
      ? [...shown, id]
      : shown.filter((pickedId) => pickedId !== id)
    setOptimistic({ from: picked, roles })
    save.mutate(roles)
  }

  return { picked: shown, setPicked, error: save.error }
}
