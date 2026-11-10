import { Badge } from '#ui/components/ui/badge'
import { accountLabel, stateLabel } from '#ui/features/logins/logins.ts'
import type { LoginRow } from '#services/dashboard/agent-protocol.ts'

const VARIANT: Record<LoginRow['state'], 'success' | 'outline' | 'warning'> = {
  'logged-in': 'success',
  'not-asked': 'outline',
  unknown: 'outline',
  'logged-out': 'warning',
  'no-cli': 'warning',
}

// One login of a source, on one line in its panel of the Sources card: its
// name, its account (and as whom, when logged in), and its state. What to run
// when it waits for you is in Needs attention.
export function LoginState({ login }: { login: LoginRow }) {
  const account = [
    accountLabel(login),
    login.state === 'logged-in' ? login.detail : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate font-medium">{login.name}</span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {account}
      </span>
      <Badge variant={VARIANT[login.state]} className="shrink-0">
        {stateLabel(login.state)}
      </Badge>
    </div>
  )
}
