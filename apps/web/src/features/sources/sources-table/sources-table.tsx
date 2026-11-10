import { Separator } from '#ui/components/ui/separator'
import type { LoginRow } from '#services/dashboard/agent-protocol.ts'
import type { Source } from '#ui/features/live-data/live-data.ts'
import { LoginState } from '#ui/features/logins/login-state'
import { plural } from '#ui/lib/plural.ts'

// "8 templates · 16 roles", what a source offers
const contentOf = ({ docker, ansible }: Source) =>
  [
    docker ? plural(docker, 'template') : null,
    ansible ? plural(ansible, 'role') : null,
  ]
    .filter(Boolean)
    .join(' · ') || 'Nothing to install yet'

// The sources, one block each: what it is and offers, then the accounts it
// needs, as the dashboard agent checked them (logins: null when it could
// not, not running or still checking)
export function SourcesTable({
  sources,
  logins,
}: {
  sources: Source[]
  logins: LoginRow[] | null
}) {
  return (
    <ul className="flex flex-col">
      {sources.map((source, index) => {
        const own = logins?.filter(({ sources: of }) =>
          of.includes(source.name),
        )
        return (
          <li
            key={source.name}
            aria-label={source.label ?? source.name}
            className="flex flex-col gap-3"
          >
            {index > 0 ? <Separator className="mb-1" /> : null}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  {source.label ?? source.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {[source.label ? source.name : null, source.origin]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0 text-sm">
                {contentOf(source)}
              </span>
            </div>
            {own?.length ? (
              <div className="bg-muted/50 flex flex-col gap-3 rounded-md p-3">
                <span className="text-muted-foreground text-xs font-medium">
                  {own.length === 1 ? 'Login' : 'Logins'}
                </span>
                {own.map((login) => (
                  <LoginState
                    key={`${login.type}:${login.title}:${login.name}`}
                    login={login}
                  />
                ))}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
