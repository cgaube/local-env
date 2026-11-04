import { ArrowUpRightIcon } from 'lucide-react'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#ui/components/ui/sidebar'
import { useLiveData } from '#ui/features/live-data/live-data-provider'

// The apps of the core stack (Dockhand), opened in a new tab: sidebar-07's
// projects group, hidden while the sidebar shows only icons
export function NavApps() {
  const { services } = useLiveData()
  const apps = (services ?? []).filter((service) => service.app && service.url)
  if (!apps.length) return null

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Apps</SidebarGroupLabel>
      <SidebarMenu>
        {apps.map((service) => (
          <SidebarMenuItem key={service.service}>
            <SidebarMenuButton
              render={
                <a
                  href={service.url ?? undefined}
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              <ArrowUpRightIcon />
              <span>{service.app?.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
