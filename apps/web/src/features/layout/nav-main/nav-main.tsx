import { Link, useRouterState } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#ui/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#ui/components/ui/tooltip'
import { NAVIGATION } from '#ui/features/layout/navigation.ts'
import { useToolChanges } from '#ui/features/tools/use-tool-changes.ts'

// sidebar-07's main group, without its folding sections: one link a page.
// A section with pages links to its first one. Collapsed, a tooltip names
// each icon.
export function NavMain() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  // What the next install changes: seen from every page
  const { count } = useToolChanges()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
      <SidebarMenu>
        {NAVIGATION.map((section) => (
          <SidebarMenuItem key={section.title}>
            <SidebarMenuButton
              // Collapsed, the badge is hidden: the tooltip gives the count
              tooltip={
                section.to === '/tools' && count > 0
                  ? `${section.title}: ${count} to install`
                  : section.title
              }
              isActive={pathname === section.to}
              className="data-active:text-primary"
              render={<Link to={section.to ?? section.items[0]?.to ?? '/'} />}
            >
              <section.icon />
              <span>{section.title}</span>
            </SidebarMenuButton>
            {section.to === '/tools' && count > 0 ? (
              <Tooltip>
                {/* The badge ignores the pointer, as shadcn makes it: back on
                    for its tooltip */}
                <TooltipTrigger
                  render={
                    <SidebarMenuBadge
                      aria-label={`${count} to install`}
                      className="pointer-events-auto cursor-default"
                    />
                  }
                >
                  {count}
                </TooltipTrigger>
                <TooltipContent side="right">
                  {count === 1 ? '1 change waits' : `${count} changes wait`} for
                  local-env install: tools to install or update, and unpicked
                  tools to forget
                </TooltipContent>
              </Tooltip>
            ) : null}
            {section.items ? (
              <SidebarMenuSub>
                {section.items.map((item) => (
                  <SidebarMenuSubItem key={item.to}>
                    <SidebarMenuSubButton
                      isActive={pathname === item.to}
                      className="data-active:text-primary"
                      render={<Link to={item.to} />}
                    >
                      <span>{item.title}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
