import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { saveProfile } from '#ui/features/profiles/profiles.ts'

// The profile, switched as soon as it is picked: the event stream sends the
// saved file back a moment later. The pick holds until then, while the
// stream's profile is still the one it started from.
export const useProfile = (profile: string | null) => {
  const [optimistic, setOptimistic] = useState<{
    from: string | null
    profile: string | null
  } | null>(null)
  const save = useMutation({
    mutationFn: saveProfile,
    onError: () => setOptimistic(null),
  })
  const shown =
    optimistic && optimistic.from === profile ? optimistic.profile : profile

  const setProfile = (next: string | null) => {
    if (next === shown) return
    setOptimistic({ from: profile, profile: next })
    save.mutate(next)
  }

  return { profile: shown, setProfile, error: save.error }
}
