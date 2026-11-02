import { WrenchIcon } from 'lucide-react'
import { Card } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { PageHeader } from '#ui/features/page-header/page-header'
import { plural } from '#ui/lib/plural.ts'

export function CatalogPage() {
  const { sources } = useLiveData()
  const roles = sources?.reduce((sum, source) => sum + source.ansible, 0) ?? 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catalog"
        description="The tools your sources can install on this Mac"
      />
      <Card className="py-0">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WrenchIcon />
            </EmptyMedia>
            <EmptyTitle>The catalog is coming</EmptyTitle>
            <EmptyDescription>
              {roles
                ? `Your sources have ${plural(roles, 'Ansible role')}. Soon you will pick the ones to install here.`
                : 'Soon you will pick the tools to install here, from the ansible/ folders of your sources.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    </div>
  )
}
