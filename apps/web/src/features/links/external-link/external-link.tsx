import type { ComponentProps } from 'react'
import { cn } from '#ui/lib/utils'

// A link that opens in a new tab: purple, pink on hover, like the CLI
export function ExternalLink({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      target="_blank"
      rel="noopener"
      className={cn(
        'text-link hover:text-link-hover underline-offset-4 transition-colors hover:underline',
        className,
      )}
      {...props}
    />
  )
}
