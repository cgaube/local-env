import { Link } from '@tanstack/react-router'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#ui/components/ui/sidebar'
import { useDomain } from '#ui/features/config/use-domain.ts'
import { Logo } from '#ui/features/layout/logo'

// The top of the sidebar: the logo and the domain, linked to the overview
export function SidebarBrand() {
  const domain = useDomain()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link to="/" />}>
          {/* sidebar-07's logo box: the button's size once collapsed, so the
              logo stays centered. The button makes its icons size-4: ! wins. */}
          <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
            <Logo className="size-6!" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">local-env</span>
            <span className="text-muted-foreground truncate text-xs">
              {domain ? `*.${domain}` : ''}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
