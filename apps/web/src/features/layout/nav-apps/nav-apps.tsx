import { ArrowUpRightIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#ui/components/ui/sidebar'
import { useLiveData } from '#ui/features/live-data/live-data-provider'

// The apps of the core stack (Dockhand), opened in a new tab: sidebar-16's
// secondary navigation, at the bottom of the sidebar
export function NavApps(props: ComponentProps<typeof SidebarGroup>) {
  const { services } = useLiveData()
  const apps = (services ?? []).filter((service) => service.app && service.url)
  if (!apps.length) return null

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {apps.map((service) => (
            <SidebarMenuItem key={service.service}>
              <SidebarMenuButton
                size="sm"
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
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
