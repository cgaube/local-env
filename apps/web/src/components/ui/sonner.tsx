// Our theme (features/theme), not next-themes: the same values
import { useTheme } from '#ui/features/theme/theme-provider'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'

// A tint of each status color over the popover, the color as text: the
// badges' look, in light and dark. Info is the brand's purple.
const STATUS_COLORS = Object.fromEntries(
  (
    [
      ['success', 'var(--success)'],
      ['info', 'var(--primary)'],
      ['warning', 'var(--warning)'],
      ['error', 'var(--destructive)'],
    ] as const
  ).flatMap(([kind, color]) => [
    [`--${kind}-bg`, `color-mix(in oklab, ${color} 12%, var(--popover))`],
    [`--${kind}-border`, `color-mix(in oklab, ${color} 30%, var(--popover))`],
    [`--${kind}-text`, color],
  ]),
)

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      // Colored by kind, with our theme's colors (STATUS_COLORS)
      richColors
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          ...STATUS_COLORS,
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
