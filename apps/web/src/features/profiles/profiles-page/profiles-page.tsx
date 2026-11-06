import { LayersIcon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert'
import { Card } from '#ui/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import { Skeleton } from '#ui/components/ui/skeleton'
import type { Tools } from '#ui/features/live-data/live-data.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { PageHeader } from '#ui/features/page-header/page-header'
import { InstallButton } from '#ui/features/tools/install-button'
import { CurrentProfileCard } from '#ui/features/profiles/current-profile-card'
import { ProfileSheet } from '#ui/features/profiles/profile-sheet'
import { profileRows } from '#ui/features/profiles/profiles.ts'
import { ProfilesTable } from '#ui/features/profiles/profiles-table'
import { useProfile } from '#ui/features/profiles/use-profile.ts'

function Profiles({ tools }: { tools: Tools }) {
  const { profile, setProfile, error } = useProfile(tools.profile)
  const [opened, setOpened] = useState<string | null>(null)
  // The picked profile shows as soon as it is picked
  const rows = profileRows({ ...tools, profile })
  const current = rows.find((row) => row.current) ?? null
  const pick = (id: string | null) => {
    setProfile(id)
    setOpened(null)
  }

  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Your profile wasn't saved</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      <CurrentProfileCard profile={current} onDetails={setOpened} />
      <ProfilesTable rows={rows} onOpen={setOpened} onPick={pick} />
      <ProfileSheet
        profile={rows.find((row) => row.id === opened) ?? null}
        installed={tools.installed}
        onOpenChange={(open) => {
          if (!open) setOpened(null)
        }}
        onUse={pick}
      />
    </>
  )
}

export function ProfilesPage() {
  const { tools } = useLiveData()
  const hasProfiles = tools?.roles.some((role) => role.isProfile) ?? false

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profiles"
        description="A profile is a whole setup: the tools your sources install on this Mac and the Docker stacks they need. Pick yours here, then install it."
      >
        <InstallButton />
      </PageHeader>
      {!tools ? (
        <Card className="py-0">
          <div className="p-4">
            <Skeleton className="h-6" />
          </div>
        </Card>
      ) : hasProfiles ? (
        <Profiles tools={tools} />
      ) : (
        <Card className="py-0">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayersIcon />
              </EmptyMedia>
              <EmptyTitle>No profiles yet</EmptyTitle>
              <EmptyDescription>
                A profile is an Ansible role tagged profile in a source: its
                dependencies are its tools, and local-env.yml lists the stacks
                they need.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      )}
    </div>
  )
}
