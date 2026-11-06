import { SquareTerminalIcon } from 'lucide-react'
import { CopyButton } from '#ui/features/copy/copy-button'

// A command to type in a terminal, drawn like a key: a prompt, the command in
// monospace, and a button to copy it
export function CommandBox({ command }: { command: string }) {
  return (
    <div className="bg-muted/50 flex items-center gap-2 rounded-md border py-1 pr-1 pl-3 shadow-[inset_0_-2px_0_var(--color-border)]">
      <SquareTerminalIcon className="text-muted-foreground size-4 shrink-0" />
      <span aria-hidden className="text-muted-foreground font-mono text-sm">
        $
      </span>
      <kbd className="min-w-0 flex-1 truncate font-mono text-sm">{command}</kbd>
      <CopyButton text={command} />
    </div>
  )
}
