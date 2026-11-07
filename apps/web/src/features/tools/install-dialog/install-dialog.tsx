import { TriangleAlertIcon } from 'lucide-react'
import type { WantedInput } from '#services/dashboard/role-graph.ts'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '#ui/components/ui/alert'
import { Button } from '#ui/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#ui/components/ui/dialog'
import { CodeSnippet } from '#ui/features/copy/code-snippet'
import { plural } from '#ui/lib/plural.ts'
import { ToolStatusBadge } from '#ui/features/tools/tool-status-badge'
import type { CatalogRow } from '#ui/features/tools/tools.ts'

function ToolList({ title, tools }: { title: string; tools: CatalogRow[] }) {
  if (tools.length === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      <ul className="flex flex-col gap-2">
        {tools.map((tool) => (
          <li key={tool.id} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{tool.label}</span>
            <span className="text-muted-foreground">{tool.source}</span>
            <span className="ml-auto">
              {tool.status ? <ToolStatusBadge status={tool.status} /> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// "git_email (Git, Node)": an input, and the roles that use it
const describeInputs = (inputs: WantedInput[]) =>
  inputs.map(({ name, roles }) => `${name} (${roles.join(', ')})`).join(', ')

// What the next `local-env install` changes, opened by the Install button
// when something waits. With the dashboard agent running, Install runs it
// here, in the terminal sheet; without it, the dialog gives the command to
// run. A profile is a set of tools, not one: its tools are listed under its
// name.
export function InstallDialog({
  open,
  onOpenChange,
  pending,
  unpicked,
  sudo,
  profile,
  missing,
  secrets,
  onOpenVariables,
  onInstall,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The tools, without the profiles
  pending: CatalogRow[]
  // Installed, then unpicked: the install forgets them, they stay installed
  unpicked: CatalogRow[]
  // The labels of what runs with sudo, the profile's own tasks included
  sudo: string[]
  // Only its name is shown
  profile: { label: string } | null
  // Required, without a value: the install asks for them
  missing: WantedInput[]
  // Required secrets: the install stops, local-env can't give them yet
  secrets: WantedInput[]
  // Opens the Variables sheet to set them
  onOpenVariables: (() => void) | null
  // Runs `local-env install` through the agent: null when it isn't running
  onInstall: (() => void) | null
}) {
  const inProfile = pending.filter((tool) => tool.inProfile !== null)
  const picked = pending.filter((tool) => tool.inProfile === null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pending.length > 0
              ? `Install ${plural(pending.length, 'tool')}`
              : unpicked.length > 0
                ? 'Apply your changes'
                : 'Install your tools'}
          </DialogTitle>
          <DialogDescription>
            {pending.length > 0
              ? 'Picked in the catalog or in your profile, not installed on this Mac yet, or changed since. '
              : null}
            {onInstall
              ? 'Install from here, or run this in your terminal.'
              : 'Run this in your terminal.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {profile ? (
            <ToolList title={`${profile.label} profile`} tools={inProfile} />
          ) : null}
          <ToolList title="Picked" tools={picked} />
          <ToolList title="Unpicked, stay on this Mac" tools={unpicked} />
        </div>
        {missing.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Variables missing</AlertTitle>
            <AlertDescription>
              {describeInputs(missing)}. Set them in Variables before you
              install from here.
            </AlertDescription>
            {onOpenVariables ? (
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Set the variables"
                  onClick={onOpenVariables}
                >
                  Set
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}
        {secrets.length > 0 ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Secrets not supported yet</AlertTitle>
            <AlertDescription>
              {describeInputs(secrets)}. local-env cannot give a secret yet, so
              the install stops before it runs.
            </AlertDescription>
          </Alert>
        ) : null}
        <CodeSnippet code="local-env install" />
        {onInstall ? null : (
          <p className="text-muted-foreground text-sm">
            To install from here, run{' '}
            <code className="font-mono">local-env start</code>: it starts the
            agent that runs the install on this Mac.
          </p>
        )}
        {sudo.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            It asks for your password: {sudo.join(', ')}{' '}
            {sudo.length === 1 ? 'needs' : 'need'} sudo.
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          {onInstall ? (
            // Not before the values it needs: the alert above says which
            <Button
              disabled={missing.length + secrets.length > 0}
              onClick={onInstall}
            >
              Install
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
