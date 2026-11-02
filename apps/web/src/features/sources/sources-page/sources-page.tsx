import { Card } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { Skeleton } from '#ui/components/ui/skeleton'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { PageHeader } from '#ui/features/page-header/page-header'
import { SourcesTable } from '../sources-table'

export function SourcesPage() {
  const { sources } = useLiveData()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sources"
        description="Git repos of Docker templates and Ansible roles"
      />
      <Card className="py-0">
        {!sources ? (
          <div className="p-4">
            <Skeleton className="h-6" />
          </div>
        ) : sources.length ? (
          <SourcesTable sources={sources} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No sources yet</EmptyTitle>
              <EmptyDescription>Add a git repo of templates:</EmptyDescription>
            </EmptyHeader>
            <CodeSnippet code="local-env sources add <repo>" />
          </Empty>
        )}
      </Card>
    </div>
  )
}
