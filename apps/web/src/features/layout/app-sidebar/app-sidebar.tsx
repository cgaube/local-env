import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '#ui/components/ui/sidebar'
import { NavApps } from '#ui/features/layout/nav-apps'
import { NavMain } from '#ui/features/layout/nav-main'
import { NavVersion } from '#ui/features/layout/nav-version'
import { ProfileSwitcher } from '#ui/features/tools/profile-switcher'

// sidebar-07: the profile switcher on top, the pages, the apps, and the
// version at the bottom. Collapses to its icons (the rail or the trigger).
export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <ProfileSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavApps />
      </SidebarContent>
      <SidebarFooter>
        <NavVersion />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
