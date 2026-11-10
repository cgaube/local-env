import { resolveInside } from '#cli/core/paths.js'
import { listSources, SOURCES_DIR } from '#cli/sources/sources.js'
import { tryReadSourceManifest } from '#services/dashboard/source-manifest.js'
import { logger } from '#cli/utils/logger.js'
import { askConfirm } from '#cli/utils/prompt.js'
import {
  ensureBrewInstalled,
  hasCommand,
  installBrewPackages,
} from '#cli/utils/brew.js'
import { findSourceLogin } from '#cli/logins/declared.js'
import { SESSION_TYPES } from '#cli/logins/index.js'
import { registryLogin } from '#cli/logins/registry.js'
import {
  canLogIn,
  logInToSession,
  loginCommandFor,
  readSecret,
  sessionStatus,
} from '#cli/logins/session.js'
import { parseSecretRefs, type SecretRef } from '#cli/logins/secrets.js'
import type {
  DeclaredLogin,
  SecretCommand,
  SessionLoginType,
} from '#cli/logins/types.js'

// Makes logins ready and reads secrets, for whatever needs them: a role of
// an install (wanted.ts), later a Docker stack. It finds a login and a
// secret of a source, installs the CLIs, checks the sessions (and logs in
// with the terminal), and reads the values with the vendor's CLI
// (docs/3-how-it-works/logins.md).

// What needs a login or a secret: its label, for the messages, and its
// source, the one whose secrets it gets
export type Consumer = { label: string; source: string }

// An aws or vault login, with its type
export type SessionEntry = {
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
}

// A secret of a consumer's source, ready to read
export type WantedSecret = SessionEntry & {
  consumer: Consumer
  // The variable it fills
  name: string
  secret: SecretRef
  command: SecretCommand
}

const TYPES = [...SESSION_TYPES, registryLogin]

// The login of a ref: in the source it names, else in the consumer's source
// first, then in any source
const findLogin = (consumer: Consumer, ref: string) => {
  const [named, name] = ref.includes('/')
    ? (ref.split('/') as [string, string])
    : [null, ref]
  const sources = named
    ? [named]
    : [
        consumer.source,
        ...listSources().filter((source) => source !== consumer.source),
      ]
  for (const source of sources) {
    const found = findSourceLogin(source, name, TYPES)
    if (found) return found
  }
  return null
}

// An aws or vault login, or a problem
export const findSessionLogin = (
  consumer: Consumer,
  ref: string,
  problems: string[],
): SessionEntry | null => {
  const found = findLogin(consumer, ref)
  if (!found) {
    problems.push(
      `${consumer.label} needs the login ${ref}, which no source declares.`,
    )
    return null
  }
  if (found.type === registryLogin) {
    problems.push(
      `${consumer.label} names ${ref}, a registry login: secrets and tools use aws and vault logins only.`,
    )
    return null
  }
  return found as SessionEntry
}

// The secrets of each source manifest, checked once per source
export const sourceSecrets = () => {
  const cache = new Map<string, ReturnType<typeof parseSecretRefs>>()
  return (source: string) => {
    if (!cache.has(source)) {
      const manifest = tryReadSourceManifest(resolveInside(SOURCES_DIR, source))
      cache.set(source, parseSecretRefs(manifest?.secrets ?? {}))
    }
    return cache.get(source)!
  }
}

// The secret `name` of the consumer's own source, with its login and the
// command that reads it, or a problem: the source does not declare it, its
// entry is not valid, its login is missing or of another type
export const resolveSecret = (
  consumer: Consumer,
  name: string,
  secretsOf: ReturnType<typeof sourceSecrets>,
  problems: string[],
): WantedSecret | null => {
  const declared = secretsOf(consumer.source)
  const secret = declared.secrets[name]
  if (!secret) {
    const invalid = declared.problems.find((problem) =>
      [`secrets.${name}.`, `secrets.${name}:`, `secrets.${name} `].some(
        (start) => problem.startsWith(start),
      ),
    )
    problems.push(
      invalid
        ? `${consumer.source}: local-env.yml: ${invalid}`
        : `${consumer.label} asks for the secret ${name}, which its source ${consumer.source} does not declare in the secrets of its local-env.yml.`,
    )
    return null
  }
  const found = findSessionLogin(consumer, secret.login, problems)
  if (!found) return null
  try {
    const command = found.type.secretCommand(found.login, secret)
    return { ...found, consumer, name, secret, command }
  } catch (error) {
    problems.push(
      `${consumer.source}: local-env.yml: secrets.${name}.${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

// Two secrets of one name read the same value
export const sameSecret = (a: WantedSecret, b: WantedSecret) =>
  a.login.identity === b.login.identity &&
  a.secret.ref === b.secret.ref &&
  a.secret.field === b.secret.field

const sessionKey = ({ type, login }: SessionEntry) =>
  `${type.type}:${login.identity}`

// The CLIs of these types, installed with Homebrew when missing
export const installClis = async (types: SessionLoginType<unknown>[]) => {
  const clis = [...new Map(types.map(({ cli }) => [cli.binary, cli])).values()]
  for (const { binary, formula } of clis) {
    if (await hasCommand(binary)) continue
    await ensureBrewInstalled(
      `The ${binary} CLI is missing, and Homebrew too: install Homebrew, then run local-env install again.`,
    )
    await installBrewPackages([formula])
  }
}

const loggedIn = (detail: string) =>
  `logged in ${detail.replace(/^logged in ?/, '')}`.trimEnd()

// Logged in to the account, or throws before anything runs
const ensureSession = async ({
  type,
  login,
  needs,
}: SessionEntry & { needs: string[] }) => {
  const title = `${login.name} (${type.title(login.config)})`
  const status = await sessionStatus(type, login)
  if (status.state === 'logged-in') {
    logger.success(`${title}: ${loggedIn(status.detail)}`)
    return
  }
  if (status.state === 'no-cli') {
    throw new Error(
      `${title}: the ${type.cli.binary} CLI is still not installed. Nothing ran. Run \`brew install ${type.cli.formula}\`, then local-env install again.`,
    )
  }
  const help = type.help(login.config)
  const command = loginCommandFor(login.source, login.name)
  const neededBy = `needed by ${needs.join(', ')}`
  if (!canLogIn()) {
    throw new Error(
      `${title}: not logged in, ${neededBy}. Nothing ran. In a terminal: ${command}${help ? `\n${help}` : ''}`,
    )
  }
  if (
    !(await askConfirm(
      `${title}: not logged in, ${neededBy}. Log in now?`,
      true,
    ))
  ) {
    throw new Error(
      `${title}: not logged in. Nothing ran. To log in: ${command}`,
    )
  }
  const done = await logInToSession(type, login)
  const after = await sessionStatus(type, login)
  if (!done || after.state !== 'logged-in') {
    throw new Error(
      `${title}: still not logged in. Nothing ran.${help ? `\n${help}` : ''}`,
    )
  }
  logger.success(`${title}: ${loggedIn(after.detail)}`)
}

// Each account once, with the labels of what needs it: its CLI installed and
// configured, its session checked, logged in with the terminal. Throws before
// anything runs when one is not ready.
export const ensureSessions = async (
  entries: (SessionEntry & { needs: string[] })[],
) => {
  const sessions = new Map<string, SessionEntry & { needs: string[] }>()
  for (const entry of entries) {
    const key = sessionKey(entry)
    const session = sessions.get(key) ?? { ...entry, needs: [] }
    for (const label of entry.needs) {
      if (!session.needs.includes(label)) session.needs.push(label)
    }
    sessions.set(key, session)
  }
  await installClis([...sessions.values()].map(({ type }) => type))
  for (const session of sessions.values()) {
    session.type.configure?.(session.login)
    await ensureSession(session)
  }
}

// What a secret is called in the messages
const secretTitle = ({ name, secret, login }: WantedSecret) =>
  `${name} (${secret.ref}${secret.field ? ` ${secret.field}` : ''}, ${login.name})`

// The value of each secret, by name, once its session is ready: read in
// parallel, each once. Throws an Error that names every secret that could not
// be read, before anything runs. `what` names them in the success line.
export const readSecrets = async (secrets: WantedSecret[], what: string) => {
  const values: Record<string, string> = {}
  const problems: string[] = []
  await Promise.all(
    secrets.map(async (wanted) => {
      try {
        values[wanted.name] = await readSecret(
          wanted.type,
          wanted.login,
          wanted.command,
        )
      } catch (error) {
        problems.push(
          `${wanted.consumer.label}: the secret ${secretTitle(wanted)} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),
  )
  if (problems.length > 0) {
    throw new Error(`${problems.sort().join('\n')}\nNothing ran.`)
  }
  logger.success(
    `Read ${secrets.length === 1 ? 'the secret' : `${secrets.length} secrets`} of ${what}: ${secrets.map(({ name }) => name).join(', ')}`,
  )
  // In the order they were asked for
  return Object.fromEntries(secrets.map(({ name }) => [name, values[name]!]))
}
