import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { Skeleton } from '#ui/components/ui/skeleton'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { plural } from '#ui/lib/plural.ts'
import { SourcesTable } from '#ui/features/sources/sources-table'

// On the overview: the git repos local-env installs from
export function SourcesCard() {
  const { sources } = useLiveData()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
        <CardDescription>
          {!sources
            ? 'Loading…'
            : sources.length
              ? `${plural(sources.length, 'git repo')} of Docker templates and Ansible roles`
              : 'No sources yet: add a git repo of templates and roles'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!sources ? (
          <Skeleton className="h-6" />
        ) : sources.length ? (
          <SourcesTable sources={sources} />
        ) : (
          <CodeSnippet code="local-env sources add <repo>" />
        )}
      </CardContent>
    </Card>
  )
}
