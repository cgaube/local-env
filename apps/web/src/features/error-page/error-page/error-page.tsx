import { Link, useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { ChevronDownIcon, RotateCwIcon } from 'lucide-react'
import { useState } from 'react'
import { Button, buttonVariants } from '#ui/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#ui/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#ui/components/ui/tooltip'
import { CopyButton } from '#ui/features/copy/copy-button'
import { BREAKS, BrokenLogo } from '#ui/features/error-page/broken-logo'
import type { Break } from '#ui/features/error-page/broken-logo'

const TITLES: Record<Break, string> = {
  cracked: 'Well, that cracked.',
  flatline: 'No pulse on this page.',
  unplugged: 'Someone tripped over a cable.',
  glitch: 'Signal lost somewhere in the stack.',
  melted: 'This page melted down.',
}

const readError = (error: unknown) =>
  error instanceof Error
    ? { message: error.message, details: error.stack ?? error.message }
    : { message: String(error), details: String(error) }

// What the router shows when a page throws: the logo broken one of a few
// ways (a new one on each error, and on a click on it), the error, and the
// way out.
// Your containers and tools don't care: only the page broke.
export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * BREAKS.length),
  )
  const variant = BREAKS[index]!
  const { message, details } = readError(error)

  return (
    <Empty className="min-h-full">
      <EmptyHeader className="max-w-md">
        <EmptyMedia>
          {/* The logo breaks another way on a click: a toy, kept out of the
              buttons, which are the way out */}
          <Tooltip>
            <TooltipTrigger
              aria-label="Break it another way"
              onClick={() => setIndex((i) => (i + 1) % BREAKS.length)}
              className="animate-broken-float focus-visible:ring-ring/50 cursor-pointer rounded-3xl outline-none focus-visible:ring-3 motion-reduce:animate-none"
            >
              <BrokenLogo
                variant={variant}
                className="size-40 transition-transform active:scale-95"
              />
            </TooltipTrigger>
            <TooltipContent>Break it another way</TooltipContent>
          </Tooltip>
        </EmptyMedia>
        <EmptyTitle className="text-2xl font-semibold">
          <h1>{TITLES[variant]}</h1>
        </EmptyTitle>
        <EmptyDescription>
          Something broke while drawing this page. Your containers and tools are
          fine: try again, or head back to the overview.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-md">
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              reset()
              void router.invalidate()
            }}
          >
            <RotateCwIcon data-icon="inline-start" />
            Try again
          </Button>
          {/* A link, which a Base UI button would turn into a button */}
          <Link to="/" className={buttonVariants({ variant: 'outline' })}>
            Back to the overview
          </Link>
        </div>
        <Collapsible className="w-full">
          <CollapsibleTrigger
            render={
              <Button variant="link" size="sm" className="group mx-auto" />
            }
          >
            What broke
            <ChevronDownIcon
              data-icon="inline-end"
              className="transition-transform group-data-panel-open:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-1 rounded-lg border bg-card p-3 text-left">
            <code className="text-destructive font-mono text-xs break-words">
              {message}
            </code>
            <div className="self-end">
              <CopyButton text={details} label="Copy the error" />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </EmptyContent>
    </Empty>
  )
}
