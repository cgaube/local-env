import { Outlet } from '@tanstack/react-router'
import { SidebarInset, SidebarProvider } from '#ui/components/ui/sidebar'
import { Toaster } from '#ui/components/ui/sonner'
import { AppSidebar } from '#ui/features/layout/app-sidebar'
import { SiteHeader } from '#ui/features/layout/site-header'
import { InstallToast } from '#ui/features/tools/install-toast'

// sidebar-07: the sidebar, collapsing to its icons, and beside it the page
// under its header
export function AppShell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* White cards on a muted canvas, like the shadcn/create preview.
          Dark cards already stand out from the background. */}
      <SidebarInset className="bg-muted dark:bg-background">
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
      {/* What a background action found (Check for updates) */}
      <Toaster />
      <InstallToast />
    </SidebarProvider>
  )
}
