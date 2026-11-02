import { Badge } from '#ui/components/ui/badge'
import { ExternalLink } from '#ui/features/links/external-link'

const CHANGELOG = 'https://github.com/cgaube/local-env/blob/main/CHANGELOG.md'

const DEV_LABELS = {
  checkout: {
    label: 'Dev build',
    title: 'Built from a checkout (bun run compile), not a Homebrew release',
  },
  'dev-server': {
    label: 'Dev server',
    title: 'Served by bun run dev, with hot reload',
  },
} as const

// The version of local-env, at the bottom of the sidebar. A build that isn't
// the Homebrew release says so, with its commit: its version is only the one
// it will be released as.
export function NavVersion({ build = __LOCAL_ENV_BUILD__ }) {
  if (build.kind === 'release') {
    return (
      <p className="text-muted-foreground px-2 text-xs">
        local-env{' '}
        <ExternalLink href={CHANGELOG} title="What's new">
          v{build.version}
        </ExternalLink>
      </p>
    )
  }
  const { label, title } = DEV_LABELS[build.kind]
  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-1.5 px-2 text-xs"
      title={title}
    >
      <Badge variant="warning">{label}</Badge>
      <span>
        v{build.version}
        {build.commit ? ` · ${build.commit}` : null}
      </span>
    </div>
  )
}
