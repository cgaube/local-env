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

export type LoginStatus =
  | { state: 'logged-in'; detail: string }
  | { state: 'logged-out'; detail: string }
  // The vendor's CLI is not installed: the install installs it
  | { state: 'no-cli' }

// A login whose session the vendor's CLI keeps (aws, vault): local-env
// installs the CLI, writes its config, checks the session and runs its
// login, with the terminal. It never sees a secret. A role names it, and
// its tasks get `env`.
export type SessionLoginType<Config> = LoginType<Config> & {
  // The binary, and what `brew install` takes to install it
  cli: { binary: string; formula: string }
  // The environment of every call of the CLI, and of the role's tasks
  // (local_env_logins.<name>.env)
  env: (login: DeclaredLogin<Config>) => Record<string, string>
  // Writes the config the CLI reads, that is no secret. Idempotent.
  configure?: (login: DeclaredLogin<Config>) => void
  // Exits 0 when logged in. Its stdout gives the detail: who you are.
  statusCommand: (login: DeclaredLogin<Config>) => string[]
  describeSession: (stdout: string) => string
  // Run with the terminal. null when local-env cannot log in (the user's
  // own profile): it shows the help of the source.
  loginCommand: (login: DeclaredLogin<Config>) => string[] | null
  logoutCommand: (login: DeclaredLogin<Config>) => string[] | null
  // The help of the source: who to ask for access
  help: (config: Config) => string | undefined
  // What a role gets in local_env_logins.<name>, beside `env`
  facts: (login: DeclaredLogin<Config>) => Record<string, string>
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
