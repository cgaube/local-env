import { Separator } from '#ui/components/ui/separator'
import { SidebarTrigger } from '#ui/components/ui/sidebar'
import { ThemeSwitcher } from '#ui/features/theme/theme-switcher'
import { PageBreadcrumb } from '#ui/features/layout/page-breadcrumb'

// sidebar-07: the page's header, lower while the sidebar shows only icons
export function SiteHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <PageBreadcrumb />
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  )
}
