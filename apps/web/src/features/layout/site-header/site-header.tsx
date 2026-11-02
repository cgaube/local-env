import { PanelLeftIcon } from 'lucide-react'
import { Button } from '#ui/components/ui/button'
import { Separator } from '#ui/components/ui/separator'
import { useSidebar } from '#ui/components/ui/sidebar'
import { ThemeSwitcher } from '#ui/features/theme/theme-switcher'
import { PageBreadcrumb } from '../page-breadcrumb'

// sidebar-16: a sticky header across the page, above the sidebar
export function SiteHeader() {
  const { toggleSidebar } = useSidebar()

  return (
    <header className="bg-background sticky top-0 z-50 flex w-full items-center border-b">
      <div className="flex h-(--header-height) w-full items-center gap-2 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Toggle the sidebar"
          onClick={toggleSidebar}
        >
          <PanelLeftIcon />
        </Button>
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <div className="hidden sm:block">
          <PageBreadcrumb />
        </div>
        <div className="ml-auto">
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  )
}
