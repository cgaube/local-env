import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '#ui/components/ui/sidebar'
import { NavApps } from '#ui/features/layout/nav-apps'
import { NavMain } from '#ui/features/layout/nav-main'
import { NavProfile } from '#ui/features/layout/nav-profile'
import { NavVersion } from '#ui/features/layout/nav-version'
import { SidebarBrand } from '#ui/features/layout/sidebar-brand'

// sidebar-07: the logo on top, the pages, the apps, then the version and, at
// the very bottom like its NavUser, your profile. Collapses to its icons (the
// rail or the trigger).
export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavApps />
      </SidebarContent>
      <SidebarFooter>
        <NavVersion />
        <NavProfile />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
