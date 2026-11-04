import { Link, useRouterState } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#ui/components/ui/sidebar'
import { NAVIGATION } from '#ui/features/layout/navigation.ts'

// sidebar-07's main group, without its folding sections: one link a page.
// A section with pages links to its first one. Collapsed, a tooltip names
// each icon.
export function NavMain() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
      <SidebarMenu>
        {NAVIGATION.map((section) => (
          <SidebarMenuItem key={section.title}>
            <SidebarMenuButton
              tooltip={section.title}
              isActive={pathname === section.to}
              className="data-active:text-primary"
              render={<Link to={section.to ?? section.items[0]?.to ?? '/'} />}
            >
              <section.icon />
              <span>{section.title}</span>
            </SidebarMenuButton>
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
