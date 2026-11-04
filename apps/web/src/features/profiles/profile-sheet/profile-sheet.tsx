import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#ui/components/ui/sheet'
import type { Tools } from '#ui/features/live-data/live-data.ts'
import type { ProfileRow } from '#ui/features/profiles/profiles.ts'
import { ToolStatusBadge } from '#ui/features/tools/tool-status-badge'
import { stackName } from '#ui/features/tools/tools.ts'

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {children}
    </section>
  )
}

// Everything a profile brings, before it is picked: its tools at every depth
// and the stacks they need
export function ProfileSheet({
  profile,
  installed,
  onOpenChange,
  onUse,
}: {
  profile: ProfileRow | null
  installed: Tools['installed']
  onOpenChange: (open: boolean) => void
  onUse: (id: string | null) => void
}) {
  return (
    <Sheet open={profile !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {profile ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {profile.name}
                {profile.current ? <Badge>Your profile</Badge> : null}
              </SheetTitle>
              <SheetDescription>
                {profile.description ?? `A profile of ${profile.source}`}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 overflow-y-auto px-4">
              {profile.includes.length > 0 ? (
                <Section title="Includes">
                  <div className="flex flex-wrap gap-1">
                    {profile.includes.map((name) => (
                      <Badge key={name} variant="outline">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </Section>
              ) : null}
              <Section title={`Tools (${profile.tools.length})`}>
                {profile.tools.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {profile.tools.map((tool) => {
                      const install = installed[tool.id]
                      return (
                        <li
                          key={tool.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className="font-medium">{tool.name}</span>
                          {/* Only a tool from another source says which */}
                          {tool.source !== profile.source ? (
                            <span className="text-muted-foreground truncate">
                              {tool.source}
                            </span>
                          ) : null}
                          <span className="ml-auto shrink-0">
                            <ToolStatusBadge
                              status={
                                !install
                                  ? 'to-install'
                                  : install.revision === tool.revision
                                    ? 'installed'
                                    : 'update'
                              }
                            />
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No tools.</p>
                )}
              </Section>
              <Section title={`Stacks (${profile.stackStates.length})`}>
                {profile.stackStates.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {profile.stackStates.map(({ stack, deployed }) => (
                      <li
                        key={stack}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="font-medium">
                          {stackName(stack, profile.source)}
                        </span>
                        <span className="ml-auto shrink-0">
                          <Badge variant={deployed ? 'success' : 'warning'}>
                            {deployed ? 'Deployed' : 'To deploy'}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Needs no Docker stack.
                  </p>
                )}
              </Section>
            </div>
            <SheetFooter>
              {profile.current ? (
                <Button variant="outline" onClick={() => onUse(null)}>
                  Stop using it
                </Button>
              ) : (
                <Button onClick={() => onUse(profile.id)}>
                  Use this profile
                </Button>
              )}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
