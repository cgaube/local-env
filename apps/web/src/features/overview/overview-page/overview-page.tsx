import { PageHeader } from '#ui/features/page-header/page-header'
import { SourcesCard } from '#ui/features/sources/sources-card'
import { AttentionCard } from '#ui/features/overview/attention-card'
import { HealthCard } from '#ui/features/overview/health-card'

// What needs you first, beside the health of the core services, then the
// sources and their logins, across the page. The apps (Dockhand…) are in the
// sidebar.
export function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="How your local environment is doing, at a glance"
      />

      {/* Both as tall as the taller one: no gap beside Health */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex lg:col-span-2">
          <AttentionCard />
        </div>
        <HealthCard />
      </div>

      <SourcesCard />
    </div>
  )
}
