// A kind of account that a source can need the user to be signed in to,
// declared in the `logins` of its manifest with a `type`
// (docs/3-how-it-works/logins.md). Each type checks its own fields; the
// commands only use these interfaces.

// Where a login is declared: its source, and its key in the manifest
export type LoginPlace = { source: string; name: string }

export type LoginType<Config> = {
  // The `type:` of the manifest entry
  type: string
  // The manifest entry to its config. Throws an Error that names the field.
  parse: (entry: Record<string, unknown>) => Config
  // Two declarations with the same identity are one account, shared by the
  // sources that declare it
  identity: (config: Config, place: LoginPlace) => string
  // What the user reads: ghcr.io
  title: (config: Config) => string
}

// A login as a source declares it
export type DeclaredLogin<Config> = LoginPlace & {
  identity: string
  config: Config
}

// Text that a manifest entry may give, trimmed; undefined when empty
export const optionalText = (
  entry: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = entry[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be text`)
  return value.trim() || undefined
}

export const requiredText = (entry: Record<string, unknown>, field: string) => {
  const value = optionalText(entry, field)
  if (!value) throw new Error(`${field} is required`)
  return value
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
