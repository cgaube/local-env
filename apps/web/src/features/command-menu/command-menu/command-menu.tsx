import { useNavigate } from '@tanstack/react-router'
import { DownloadIcon, RefreshCwIcon, SquareTerminalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '#ui/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '#ui/components/ui/command'
import { Kbd, KbdGroup } from '#ui/components/ui/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#ui/components/ui/tooltip'
import { NAVIGATION } from '#ui/features/layout/navigation.ts'
import { useLiveData } from '#ui/features/live-data/live-data-provider'
import { useTerminal } from '#ui/features/terminal/terminal-provider'
import { useToolChanges } from '#ui/features/tools/use-tool-changes.ts'
import { plural } from '#ui/lib/plural.ts'

const RUNS = {
  install: {
    icon: DownloadIcon,
    label: 'Install tools',
    running: 'Show the install',
  },
  update: {
    icon: RefreshCwIcon,
    label: 'Update local-env',
    running: 'Show the update',
  },
} as const

type RunCommand = keyof typeof RUNS

// ⌘K (Ctrl+K too) opens it from any page, except in the terminal, whose
// shell keeps Ctrl+K
const isShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === 'k' &&
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  !event.shiftKey &&
  !(event.target instanceof Element && event.target.closest('.xterm'))

// The command palette, beside the theme switcher: runs `local-env install`
// or `update` in the terminal sheet, through the dashboard agent, and goes
// to a page
export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const { agent } = useLiveData()
  const terminal = useTerminal()
  const changes = useToolChanges()
  const navigate = useNavigate()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcut(event)) return
      event.preventDefault()
      setOpen((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const runs = (command: RunCommand) =>
    agent?.run?.command === command && agent.run.status === 'running'
  // Why a command can't run from here: like the Install and Update buttons
  const blocked = (command: RunCommand) => {
    if (runs(command)) return null
    if (!agent?.available) return 'Run local-env start first'
    if (
      command === 'install' &&
      changes.missing.length + changes.secrets.length > 0
    ) {
      return 'Set the missing variables first'
    }
    return null
  }
  const hint = (command: RunCommand) =>
    blocked(command) ??
    (command === 'install' && changes.count > 0 && !runs(command)
      ? plural(changes.count, 'change')
      : null)

  const select = (action: () => void) => {
    setOpen(false)
    action()
  }

  return (
    <>
      {/* The shortcut shows on the button: found without a hover */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label="Commands"
              onClick={() => setOpen(true)}
            />
          }
        >
          <SquareTerminalIcon data-icon="inline-start" />
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </TooltipTrigger>
        <TooltipContent>Run install or update, or go to a page</TooltipContent>
      </Tooltip>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Commands"
        description="Run local-env install or update, or go to a page"
      >
        <Command>
          <CommandInput placeholder="Type a command or a page…" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup heading="Run">
              {(Object.keys(RUNS) as RunCommand[]).map((command) => {
                const { icon: Icon, label, running } = RUNS[command]
                const text = hint(command)
                return (
                  <CommandItem
                    key={command}
                    value={`local-env ${command} ${label}`}
                    disabled={blocked(command) !== null}
                    onSelect={() =>
                      select(() =>
                        runs(command) ? terminal.show() : terminal.run(command),
                      )
                    }
                  >
                    <Icon />
                    {runs(command) ? running : label}
                    {text ? (
                      <CommandShortcut className="tracking-normal">
                        {text}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            <CommandGroup heading="Go to">
              {NAVIGATION.map((section) => {
                const to = section.to ?? section.items[0]?.to ?? '/'
                return (
                  <CommandItem
                    key={section.title}
                    value={`go to ${section.title}`}
                    onSelect={() => select(() => void navigate({ to }))}
                  >
                    <section.icon />
                    {section.title}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
