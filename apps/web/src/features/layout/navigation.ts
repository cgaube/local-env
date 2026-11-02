import {
  ContainerIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  WrenchIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavLink = { title: string; to: string }

export type NavSection = {
  title: string
  icon: LucideIcon
} & ({ to: string; items?: never } | { to?: never; items: NavLink[] })

// The sidebar. Each path is a route in router.tsx.
export const NAVIGATION: NavSection[] = [
  { title: 'Overview', icon: LayoutDashboardIcon, to: '/' },
  {
    title: 'Docker',
    icon: ContainerIcon,
    items: [{ title: 'Routes', to: '/docker/routes' }],
  },
  {
    title: 'Tools',
    icon: WrenchIcon,
    items: [
      { title: 'Catalog', to: '/tools/catalog' },
      { title: 'Installed', to: '/tools/installed' },
    ],
  },
  { title: 'Sources', icon: GitBranchIcon, to: '/sources' },
]

// The section and page of a path, for the breadcrumb
export const findPage = (pathname: string) => {
  for (const section of NAVIGATION) {
    if (section.to === pathname) return { section: null, page: section.title }
    const item = section.items?.find((link) => link.to === pathname)
    if (item) return { section: section.title, page: item.title }
  }
  return null
}
