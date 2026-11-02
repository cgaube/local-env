import { Link } from '@tanstack/react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#ui/components/ui/sidebar'
import { useDomain } from '#ui/features/config/use-domain.ts'
import { Logo } from '../logo'
import { NavApps } from '../nav-apps'
import { NavMain } from '../nav-main'
import { NavVersion } from '../nav-version'

export function AppSidebar() {
  const domain = useDomain()

  return (
    <Sidebar className="top-(--header-height) h-[calc(100svh-var(--header-height))]!">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <Logo className="size-8 shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">local-env</span>
                <span className="text-muted-foreground truncate text-xs">
                  {domain ? `*.${domain}` : ''}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavApps className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavVersion />
      </SidebarFooter>
    </Sidebar>
  )
}
