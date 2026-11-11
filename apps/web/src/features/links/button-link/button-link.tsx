import { Link, type LinkProps } from '@tanstack/react-router'
import type { VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { buttonVariants } from '#ui/components/ui/button'
import { cn } from '#ui/lib/utils'

type ButtonLinkProps = VariantProps<typeof buttonVariants> & {
  className?: string
  children: ReactNode
} & (
    | // A page of the dashboard
      { to: LinkProps['to'] }
    // Elsewhere, in a new tab
    | { href: string }
  )

// A link that looks like a shadcn Button. Not Button itself: drawn as a link,
// Base UI gives it role="button", so it would no longer read or open as a
// link. cn() merges the variant's classes as Button does: without it, the
// base's border-transparent can win over the outline's border.
export function ButtonLink({
  variant,
  size,
  className,
  children,
  ...target
}: ButtonLinkProps) {
  const classes = cn(buttonVariants({ variant, size }), className)
  return 'href' in target ? (
    <a href={target.href} target="_blank" rel="noopener" className={classes}>
      {children}
    </a>
  ) : (
    <Link to={target.to} className={classes}>
      {children}
    </Link>
  )
}
