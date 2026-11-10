// The manifest of a source, local-env.yml at its root. JSON is YAML, and it
// keeps the test data plain objects.
export const buildManifest = ({
  name,
  label,
  logins = {},
  secrets,
}: {
  name: string
  label?: string
  logins?: Record<string, unknown>
  secrets?: Record<string, unknown>
}) => `${JSON.stringify({ name, label, logins, secrets }, null, 2)}\n`

// "https://GHCR.io/team-a" -> "ghcr-io-team-a"
export const loginNameFor = (host: string) =>
  host
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// A registry login for each entry ({ host, usernameHelp?, tokenHelp? }),
// named after its host
export const registryLogins = (registries: Record<string, unknown>[]) =>
  Object.fromEntries(
    registries.map((registry) => [
      loginNameFor(String(registry.host)),
      { type: 'registry', ...registry },
    ]),
  )

// The files of a source that needs these registries
export const manifestFiles = (
  name: string,
  registries: Record<string, unknown>[],
) => ({
  'local-env.yml': buildManifest({ name, logins: registryLogins(registries) }),
})
