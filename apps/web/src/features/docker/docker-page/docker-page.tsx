import { getRouteApi } from '@tanstack/react-router'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '#ui/components/ui/tabs'
import { TemplatesPanel } from '#ui/features/docker/templates-panel'
import { PageHeader } from '#ui/features/page-header/page-header'
import { RoutesPanel } from '#ui/features/routes/routes-panel'

const route = getRouteApi('/docker')

export type DockerTab = 'templates' | 'routes'

// The Docker page: the templates of the sources, to deploy, and the routes of
// what runs. The tab is in the address (?tab=routes), so a link can open it.
export function DockerPage() {
  const { tab = 'templates' } = route.useSearch()
  const navigate = route.useNavigate()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Docker"
        description="Deploy the apps of your sources, and reach what runs"
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            search: value === 'routes' ? { tab: 'routes' } : {},
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="routes">Routes</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="pt-2">
          <TemplatesPanel />
        </TabsContent>
        <TabsContent value="routes" className="pt-2">
          <RoutesPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
