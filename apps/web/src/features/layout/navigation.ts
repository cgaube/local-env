import {
  ContainerIcon,
  LayersIcon,
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
  // A set of tools and the stacks they need: first-class, not a kind of tool
  { title: 'Profiles', icon: LayersIcon, to: '/profiles' },
  { title: 'Docker', icon: ContainerIcon, to: '/docker' },
  { title: 'Tools', icon: WrenchIcon, to: '/tools' },
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
