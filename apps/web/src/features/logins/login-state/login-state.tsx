import { Badge } from '#ui/components/ui/badge'
import { kindLabel, stateLabel } from '#ui/features/logins/logins.ts'
import type { LoginRow } from '#services/dashboard/agent-protocol.ts'

const VARIANT: Record<LoginRow['state'], 'success' | 'outline' | 'warning'> = {
  'logged-in': 'success',
  'not-asked': 'outline',
  unknown: 'outline',
  'logged-out': 'warning',
  'no-cli': 'warning',
}

// One login of a source, under it in the Sources card: its name, its account
// (and as whom, when logged in), and its state. What to run when it waits
// for you is in Needs attention.
export function LoginState({ login }: { login: LoginRow }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-0.5 sm:grid-cols-[10rem_1fr_auto]">
      <span className="truncate font-medium sm:row-span-1">{login.name}</span>
      <Badge
        variant={VARIANT[login.state]}
        className="justify-self-end sm:col-start-3 sm:row-start-1"
      >
        {stateLabel(login.state)}
      </Badge>
      <div className="text-muted-foreground col-span-2 flex min-w-0 flex-col text-xs sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-sm">
        <span className="truncate">
          {kindLabel(login.type)} · {login.title}
        </span>
        {login.state === 'logged-in' && login.detail ? (
          <span className="truncate text-xs">{login.detail}</span>
        ) : null}
      </div>
    </div>
  )
}
