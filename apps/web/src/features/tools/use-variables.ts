import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { saveVariables } from '#ui/features/tools/tools.ts'

// The values with the changes applied: undefined removes a name
const applyChanges = (
  values: Record<string, unknown>,
  changes: Record<string, unknown>,
) =>
  Object.fromEntries(
    Object.entries({ ...values, ...changes }).filter(
      ([, value]) => value !== undefined,
    ),
  )

// The values of the inputs, changed as soon as one is set. Only the changes
// are sent: the server merges them into the file, so a value the CLI saved
// meanwhile stays. The changes show on top of the stream's values until the
// stream sends the saved file back.
export const useVariables = (variables: Record<string, unknown>) => {
  const [optimistic, setOptimistic] = useState<{
    from: Record<string, unknown>
    changes: Record<string, unknown>
  } | null>(null)
  const save = useMutation({
    mutationFn: saveVariables,
    // Only this change is undone: the stream's file says what was saved
    onError: (_error, sent) =>
      setOptimistic((current) =>
        current
          ? {
              ...current,
              changes: Object.fromEntries(
                Object.entries(current.changes).filter(
                  ([name]) => !(name in sent),
                ),
              ),
            }
          : null,
      ),
  })
  const pending = optimistic?.from === variables ? optimistic.changes : {}

  // By name: undefined clears it, and the role's default applies again
  const setValues = (changes: Record<string, unknown>) => {
    if (Object.keys(changes).length === 0) return
    setOptimistic({ from: variables, changes: { ...pending, ...changes } })
    save.mutate(
      Object.fromEntries(
        Object.entries(changes).map(([name, value]) => [name, value ?? null]),
      ),
    )
  }

  return {
    variables: applyChanges(variables, pending),
    setValues,
    error: save.error,
  }
}
