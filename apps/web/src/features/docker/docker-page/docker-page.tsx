import { OtherApps } from '#ui/features/docker/other-apps'
import { TemplatesPanel } from '#ui/features/docker/templates-panel'
import { PageHeader } from '#ui/features/page-header/page-header'

// The Docker page: the templates of the sources, to deploy, each with whether
// it runs and its address, then the other apps behind the proxy
export function DockerPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Docker"
        description="Deploy the apps of your sources, and reach what runs"
      />
      <TemplatesPanel />
      <OtherApps />
    </div>
  )
}
