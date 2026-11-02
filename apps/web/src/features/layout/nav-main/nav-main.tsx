import { Link, useRouterState } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#ui/components/ui/sidebar'
import { NAVIGATION } from '../navigation.ts'

// Every section open: too few pages to fold any away. A section with pages
// links to its first one.
export function NavMain() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <SidebarGroup>
      <SidebarMenu>
        {NAVIGATION.map((section) => (
          <SidebarMenuItem key={section.title}>
            <SidebarMenuButton
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
