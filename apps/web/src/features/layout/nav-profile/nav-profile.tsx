import { Link } from '@tanstack/react-router'
import { UserRoundIcon } from 'lucide-react'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#ui/components/ui/sidebar'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { currentProfile } from '#ui/features/tools/tools.ts'

// A path of navigation.ts, typed as one like the sidebar's links
const PROFILES: string = '/profiles'

// The profile local-env installs, at the bottom of the sidebar where
// sidebar-07 puts who you are (its NavUser): it opens the Profiles page. Not
// there without profiles in the sources.
export function NavProfile() {
  const { tools } = useLiveData()
  if (!tools?.roles.some((role) => role.isProfile)) return null
  const profile = currentProfile(tools)
  const label = `Profile: ${profile?.name ?? 'none'}`

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          // Collapsed, only the icon shows: the tooltip names the profile
          tooltip={label}
          aria-label={label}
          render={<Link to={PROFILES} />}
        >
          {/* The button's size once collapsed, so the icon stays centered */}
          <div className="bg-sidebar-accent text-sidebar-accent-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg">
            <UserRoundIcon />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">
              {profile?.name ?? 'No profile'}
            </span>
            <span className="text-muted-foreground truncate text-xs">
              Profile
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
