import { ExternalLink } from '#ui/features/links/external-link'

const CHANGELOG = 'https://github.com/cgaube/local-env/blob/main/CHANGELOG.md'

// The version of local-env, at the bottom of the sidebar
export function NavVersion() {
  return (
    <p className="text-muted-foreground px-2 text-xs">
      local-env{' '}
      <ExternalLink href={CHANGELOG} title="What's new">
        v{__LOCAL_ENV_VERSION__}
      </ExternalLink>
    </p>
  )
}
