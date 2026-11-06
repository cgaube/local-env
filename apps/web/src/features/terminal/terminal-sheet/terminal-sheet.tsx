import { lazy, Suspense, useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '#ui/components/ui/alert'
import { Badge } from '#ui/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#ui/components/ui/sheet'
import { Skeleton } from '#ui/components/ui/skeleton'
import { CommandBox } from '#ui/features/terminal/command-box'
import type {
  SessionState,
  TerminalSession,
} from '#ui/features/terminal/terminal-session.ts'

// Its own chunk, by path: xterm-view/ has no index.ts, so nothing imports
// it eagerly
const XtermView = lazy(
  () => import('#ui/features/terminal/xterm-view/xterm-view.tsx'),
)

function RunBadge({ state }: { state: SessionState }) {
  if (state.connection === 'reconnecting') {
    return <Badge variant="warning">Reconnecting</Badge>
  }
  if (!state.run) return null
  if (state.run.status === 'running') {
    return <Badge variant="warning">Running</Badge>
  }
  return state.run.exitCode === 0 ? (
    <Badge variant="success">Done</Badge>
  ) : (
    <Badge variant="destructive">Failed ({state.run.exitCode})</Badge>
  )
}

// The terminal of `local-env install` or `update`, run by the dashboard
// agent on this Mac. Closing it doesn't stop the command.
export function TerminalSheet({
  open,
  onOpenChange,
  session,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: TerminalSession
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const command = state.run?.command

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader>
          <div className="flex items-center gap-2 pr-8">
            <SheetTitle>Terminal</SheetTitle>
            <RunBadge state={state} />
          </div>
          <SheetDescription>
            Runs on this Mac, as you. Type in it to answer its questions.
            Closing this panel doesn&apos;t stop the command.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
          {/* What runs, to run it in a terminal instead */}
          {command ? <CommandBox command={`local-env ${command}`} /> : null}
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <Suspense fallback={<Skeleton className="flex-1" />}>
            <XtermView session={session} />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  )
}
