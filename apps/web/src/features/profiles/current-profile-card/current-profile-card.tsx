import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import type { ProfileRow } from '#ui/features/profiles/profiles.ts'
import { plural } from '#ui/lib/plural.ts'

// The profile `local-env install` installs: where its tools and stacks stand
export function CurrentProfileCard({
  profile,
  onDetails,
}: {
  profile: ProfileRow | null
  onDetails: (id: string) => void
}) {
  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No profile</CardTitle>
          <CardDescription>
            Pick one below. local-env install then installs its tools and
            deploys the Docker stacks they need.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const toDeploy = profile.stackStates.filter(({ deployed }) => !deployed)
  const waiting = profile.pending.length > 0 || toDeploy.length > 0

  return (
    <Card role="region" aria-label="Your profile">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {profile.name}
          <Badge variant="outline">{profile.source}</Badge>
        </CardTitle>
        <CardDescription>
          {profile.description ?? 'Your profile.'}
        </CardDescription>
        <CardAction>
          <Button variant="outline" onClick={() => onDetails(profile.id)}>
            Details
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium">
            Tools
          </span>
          <span className="text-sm">
            {plural(profile.tools.length, 'tool')}
            {profile.pending.length > 0 ? (
              <Badge variant="warning" className="ml-2">
                {profile.pending.length} to install
              </Badge>
            ) : profile.tools.length > 0 ? (
              <Badge variant="success" className="ml-2">
                All installed
              </Badge>
            ) : null}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs font-medium">
            Stacks
          </span>
          {/* A count, like the tools: Details lists them */}
          <span className="text-sm">
            {profile.stackStates.length > 0 ? (
              <>
                {plural(profile.stackStates.length, 'stack')}
                {toDeploy.length > 0 ? (
                  <Badge variant="warning" className="ml-2">
                    {toDeploy.length} to deploy
                  </Badge>
                ) : (
                  <Badge variant="success" className="ml-2">
                    All deployed
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </span>
        </div>
      </CardContent>
      {waiting ? (
        <CardFooter className="flex flex-col items-stretch gap-2">
          <span className="text-muted-foreground text-sm">
            Run this in your terminal to install it:
          </span>
          <CodeSnippet code="local-env install" />
        </CardFooter>
      ) : null}
    </Card>
  )
}
