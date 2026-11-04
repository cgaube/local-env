import { Link } from '@tanstack/react-router'
import { ChevronsUpDownIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#ui/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '#ui/components/ui/sidebar'
import { useDomain } from '#ui/features/config/use-domain.ts'
import { Logo } from '#ui/features/layout/logo'
import type { Role, Tools } from '#ui/features/live-data/live-data.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { useProfile } from '#ui/features/tools/use-profile.ts'

// The radio value of "No profile": ids are never empty
const NONE = ''

function Brand({ subtitle }: { subtitle: string }) {
  return (
    <>
      {/* sidebar-07's logo box: the button's size once collapsed, so the
          logo stays centered. The button makes its icons size-4: ! wins. */}
      <div className="flex aspect-square size-8 shrink-0 items-center justify-center">
        <Logo className="size-6!" />
      </div>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">local-env</span>
        <span className="text-muted-foreground truncate text-xs">
          {subtitle}
        </span>
      </div>
    </>
  )
}

function ProfileItem({ profile }: { profile: Role }) {
  return (
    <DropdownMenuRadioItem value={profile.id} className="items-start">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{profile.name}</span>
        {profile.description ? (
          <span className="text-muted-foreground text-xs">
            {profile.description}
          </span>
        ) : null}
      </div>
    </DropdownMenuRadioItem>
  )
}

function Switcher({ tools, profiles }: { tools: Tools; profiles: Role[] }) {
  const { profile, setProfile, error } = useProfile(tools.profile)
  const { isMobile } = useSidebar()
  const current = profiles.find(({ id }) => id === profile) ?? null
  const bySource = Map.groupBy(profiles, ({ source }) => source)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            aria-label={`Profile: ${current?.name ?? 'none'}`}
            className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
          />
        }
      >
        <Brand
          subtitle={
            error
              ? 'Profile not saved'
              : current
                ? `${current.name} profile`
                : 'No profile'
          }
        />
        <ChevronsUpDownIcon className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        // Beside the sidebar, which can be only icons wide
        side={isMobile ? 'bottom' : 'right'}
        sideOffset={4}
        className="w-auto max-w-80 min-w-(--anchor-width)"
      >
        {[...bySource].map(([source, sourceProfiles]) => (
          <DropdownMenuGroup key={source}>
            <DropdownMenuLabel>{source}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={current?.id ?? NONE}
              onValueChange={(value: string) => setProfile(value || null)}
            >
              {sourceProfiles.map((item) => (
                <ProfileItem key={item.id} profile={item} />
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup
            value={current?.id ?? NONE}
            onValueChange={(value: string) => setProfile(value || null)}
          >
            <DropdownMenuRadioItem value={NONE}>
              No profile
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuLabel>
            Install it with local-env install
          </DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// At the top of the sidebar: the profile, switched here (sidebar-07's team
// switcher). Without profiles in the sources, the logo and the domain.
export function ProfileSwitcher() {
  const { tools } = useLiveData()
  const domain = useDomain()
  const profiles = tools?.roles.filter((role) => role.isProfile) ?? []

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {tools && profiles.length > 0 ? (
          <Switcher tools={tools} profiles={profiles} />
        ) : (
          <SidebarMenuButton size="lg" render={<Link to="/" />}>
            <Brand subtitle={domain ? `*.${domain}` : ''} />
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
