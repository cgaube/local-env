import { Outlet } from '@tanstack/react-router'
import { SidebarInset, SidebarProvider } from '#ui/components/ui/sidebar'
import { Toaster } from '#ui/components/ui/sonner'
import { AppSidebar } from '#ui/features/layout/app-sidebar'
import { SiteHeader } from '#ui/features/layout/site-header'
import { TerminalProvider } from '#ui/features/terminal/terminal-provider'

// sidebar-07: the sidebar, collapsing to its icons, and beside it the page
// under its header. The page scrolls inside its main area, never the window:
// with no window scrollbar, a sheet or a menu that locks the scroll keeps no
// empty gutter at the edge (Base UI keeps one so the page doesn't shift).
export function AppShell() {
  return (
    <SidebarProvider className="h-svh overflow-hidden">
      {/* The terminal of install and update, open across pages */}
      <TerminalProvider>
        <AppSidebar />
        {/* White cards on a muted canvas, like the shadcn/create preview.
          Dark cards already stand out from the background. */}
        <SidebarInset className="bg-muted dark:bg-background overflow-y-auto">
          <SiteHeader />
          {/* Below the header's border: padded all round, like sidebar-06 */}
          <div className="flex flex-1 flex-col gap-4 p-4">
            <Outlet />
          </div>
        </SidebarInset>
        {/* What a background action found (Check for updates) */}
        <Toaster />
      </TerminalProvider>
    </SidebarProvider>
  )
}
