import { WrenchIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert'
import { Card } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { Skeleton } from '#ui/components/ui/skeleton'
import type { Tools } from '#ui/features/live-data/live-data.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { PageHeader } from '#ui/features/page-header/page-header'
import { CatalogTable } from '../catalog-table'
import { catalogRows } from '../tools.ts'
import { usePickedTools } from '../use-picked-tools.ts'

function Catalog({ tools }: { tools: Tools }) {
  const { picked, setPicked, error } = usePickedTools(tools.picked)
  const shown = { ...tools, picked }

  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Your pick wasn't saved</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      <CatalogTable rows={catalogRows(shown)} onPick={setPicked} />
    </>
  )
}

export function CatalogPage() {
  const { tools } = useLiveData()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tools"
        description="The tools your sources can install on this Mac. Pick them here, install them with local-env install."
      />
      {!tools ? (
        <Card className="py-0">
          <div className="p-4">
            <Skeleton className="h-6" />
          </div>
        </Card>
      ) : tools.roles.length > 0 ? (
        <Catalog tools={tools} />
      ) : (
        <Card className="py-0">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WrenchIcon />
              </EmptyMedia>
              <EmptyTitle>No tools yet</EmptyTitle>
              <EmptyDescription>
                Your sources have no Ansible roles. Each folder in the ansible/
                folder of a source is a tool.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      )}
    </div>
  )
}
