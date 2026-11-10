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

// Where it comes from, shorter: github.com/acme/templates
const originOf = (origin: string | null) =>
  origin?.replace(/^https?:\/\//, '').replace(/\.git$/, '') ?? null

// The sources, a panel each: what it is and offers, then the accounts it
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
    <ul className="flex flex-col gap-3">
      {sources.map((source) => {
        const own = logins?.filter(({ sources: of }) =>
          of.includes(source.name),
        )
        return (
          <li
            key={source.name}
            aria-label={source.label ?? source.name}
            className="border-border flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  {source.label ?? source.name}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {[source.label ? source.name : null, originOf(source.origin)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0 text-sm">
                {contentOf(source)}
              </span>
            </div>
            {own?.length ? (
              <div className="border-border flex flex-col gap-2 border-t pt-3">
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
