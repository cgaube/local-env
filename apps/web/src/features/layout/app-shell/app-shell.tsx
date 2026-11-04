import { Outlet } from '@tanstack/react-router'
import { SidebarInset, SidebarProvider } from '#ui/components/ui/sidebar'
import { AppSidebar } from '#ui/features/layout/app-sidebar'
import { SiteHeader } from '#ui/features/layout/site-header'

// sidebar-07: the sidebar, collapsing to its icons, and beside it the page
// under its header
export function AppShell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
