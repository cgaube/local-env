import { RefreshCwIcon } from 'lucide-react'
import { Button } from '#ui/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { Skeleton } from '#ui/components/ui/skeleton'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { loginsSummary, useLogins } from '#ui/features/logins/logins.ts'
import { plural } from '#ui/lib/plural.ts'
import { SourcesTable } from '#ui/features/sources/sources-table'
import { bootstrapRows } from '#ui/features/bootstrap/bootstrap.ts'

// What the card says about the logins of the sources, which the dashboard
// agent checks on the Mac (the dashboard logs in to nothing)
const loginsLine = (logins: ReturnType<typeof useLogins>) => {
  if (logins.isPending) return 'Checking the logins…'
  if (!logins.data?.available)
    return 'Start the dashboard agent to check the logins'
  return logins.data.logins.length > 0
    ? loginsSummary(logins.data.logins)
    : null
}

// On the overview: the git repos local-env installs from, and the accounts
// each one needs. The logins are checked when the page opens and on Refresh,
// never on a timer: each check is a call to AWS, Vault or Dockhand.
export function SourcesCard() {
  const { sources, tools } = useLiveData()
  const logins = useLogins()
  const rows = logins.data?.available ? logins.data.logins : null
  const line = sources?.length ? loginsLine(logins) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
        <CardDescription>
          {!sources
            ? 'Loading…'
            : sources.length
              ? [
                  `${plural(sources.length, 'git repo')} of Docker templates and Ansible roles`,
                  line,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No sources yet: add a git repo of templates and roles'}
        </CardDescription>
        {rows?.length ? (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={logins.isFetching}
              onClick={() => void logins.refetch()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {logins.isFetching ? 'Checking…' : 'Check logins'}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {!sources ? (
          <Skeleton className="h-6" />
        ) : sources.length ? (
          <SourcesTable
            sources={sources}
            logins={rows}
            bootstraps={bootstrapRows(tools)}
          />
        ) : (
          <CodeSnippet code="local-env sources add <repo>" />
        )}
      </CardContent>
    </Card>
  )
}
