import { Outlet } from '@tanstack/react-router'
import { SidebarInset, SidebarProvider } from '#ui/components/ui/sidebar'
import { AppSidebar } from '../app-sidebar'
import { SiteHeader } from '../site-header'

// sidebar-16: a sticky header, and below it the sidebar and the page
export function AppShell() {
  return (
    <div className="[--header-height:calc(--spacing(14))]">
      <SidebarProvider className="flex flex-col">
        <SiteHeader />
        <div className="flex flex-1">
          <AppSidebar />
          {/* White cards on a muted canvas, like the shadcn/create preview.
              Dark cards already stand out from the background. */}
          <SidebarInset className="bg-muted dark:bg-background">
            <div className="flex flex-1 flex-col p-4 md:p-6">
              <Outlet />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  )
}
