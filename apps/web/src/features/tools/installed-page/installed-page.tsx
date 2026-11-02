import { PackageCheckIcon } from 'lucide-react'
import { Card } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { PageHeader } from '#ui/features/page-header/page-header'

export function InstalledPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Installed"
        description="The tools local-env installed on this Mac"
      />
      <Card className="py-0">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing installed yet</EmptyTitle>
            <EmptyDescription>
              Tools you install with local-env will show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    </div>
  )
}
