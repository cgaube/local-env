import { Command } from 'commander'
import { dockhandApi } from '#cli/providers/docker/api.js'
import {
  findLoginsByRef,
  LOGIN_COMMAND,
  listAccounts,
  loginRef,
} from '#cli/logins/declared.js'
import {
  listTokenRegistries,
  refreshRegistryToken,
} from '#cli/logins/registry-tokens.js'
import { SESSION_TYPES } from '#cli/logins/index.js'
import { loginLineText } from '#cli/logins/listing.js'
import { installClis } from '#cli/logins/prepare.js'
import {
  type DockhandRegistry,
  findHostRegistry,
  findLogin,
  getRegistries,
  listDeclaredRegistries,
  logInToRegistry,
  type RegistryConfig,
  registryLogin,
  askUsername,
  fixedUsername,
  tokenQuestion,
  tokenState,
} from '#cli/logins/registry.js'
import {
  canLogIn,
  logInToSession,
  logOutOfSession,
  sessionStatus,
} from '#cli/logins/session.js'
import type { DeclaredLogin, SessionLoginType } from '#cli/logins/types.js'
import { logger } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
import {
  askConfirm,
  askPassword,
  askSelect,
  canAsk,
} from '#cli/utils/prompt.js'

// `local-env login` makes every login of the sources work: it logs in to the
// aws and vault sessions that are logged out, asks for the registry logins
// Dockhand lacks, and gets a new token for each registry whose login gets
// them (AWS ECR). It is what to
// run when a pull or a secret fails. Named logins (`acme/ghcr`) are logged in
// to again, even when they work. `local-env logout` logs out of them
// (docs/3-how-it-works/logins.md).

type SessionEntry = {
  kind: 'session'
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
}

type RegistryEntry = {
  kind: 'registry'
  login: DeclaredLogin<RegistryConfig>
}

type Entry = SessionEntry | RegistryEntry

const withErrors =
  <A extends unknown[]>(action: (...args: A) => Promise<void>) =>
  async (...args: A) => {
    try {
      await action(...args)
    } catch (error) {
      logger.error('Login failed:', error)
      process.exit(1)
    }
  }

const readStdin = async () => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const refOf = ({ login }: Entry) => loginRef(login.source, login.name)

const titleOf = (entry: Entry) =>
  entry.kind === 'session'
    ? `${refOf(entry)} (${entry.type.title(entry.login.config)})`
    : `${refOf(entry)} (${entry.login.config.host})`

// What the login is: the account of a session, the host of a registry
const detailOf = (entry: Entry) =>
  entry.kind === 'session'
    ? entry.type.title(entry.login.config)
    : entry.login.config.host

const loginLine = (entry: Entry, state: string, changed = false) =>
  logger.success(loginLineText(refOf(entry), detailOf(entry), state, changed))

const loggedInAs = (detail: string) =>
  `logged in ${detail.replace(/^logged in ?/, '')}`.trimEnd()

// Every login of the sources, each account once: the sessions first, as an
// ECR registry needs its aws login
const allEntries = (): Entry[] => [
  ...SESSION_TYPES.flatMap((type) =>
    listAccounts(type).map(({ login }): Entry => ({
      kind: 'session',
      type,
      login,
    })),
  ),
  ...listAccounts(registryLogin).map(({ login }): Entry => ({
    kind: 'registry',
    login,
  })),
]

const toEntry = ({
  type,
  login,
}: ReturnType<typeof findLoginsByRef>[number]): Entry =>
  type === registryLogin
    ? { kind: 'registry', login: login as DeclaredLogin<RegistryConfig> }
    : { kind: 'session', type: type as SessionLoginType<any>, login }

// The login each ref names: `ghcr` when one source has it, else
// `acme/ghcr`. Throws an Error that says which ref does not fit.
const resolveRefs = (refs: string[]): Entry[] =>
  refs.map((ref) => {
    const found = findLoginsByRef(ref, [...SESSION_TYPES, registryLogin])
    if (found.length === 0) {
      throw new Error(
        `No source has a login named "${ref}". See \`local-env sources list\`.`,
      )
    }
    if (found.length > 1) {
      const names = found
        .map(({ login }) => loginRef(login.source, login.name))
        .join(', ')
      throw new Error(`Several sources have a login named "${ref}": ${names}.`)
    }
    return toEntry(found[0]!)
  })

type LoginOptions = { username?: string; passwordStdin: boolean }

// The username and the token: from the options (the token from stdin, never
// a command line), else asked
const readRegistryLogin = async (
  { login }: RegistryEntry,
  saved: DockhandRegistry | undefined,
  options: LoginOptions,
) => {
  const { host, usernameHelp, tokenHelp } = login.config
  const given = options.username?.trim() || fixedUsername(host)
  if (options.passwordStdin) {
    if (!given) throw new Error('Give --username with --password-stdin.')
    return { username: given, password: await readStdin() }
  }
  const username =
    given ?? (await askUsername(host, usernameHelp, saved?.username))
  const password = (await askPassword(tokenQuestion(host, tokenHelp))).trim()
  return { username, password }
}

// What a run of `login` does, and what it could not do
type Run = {
  force: boolean
  options: LoginOptions
  registries: DockhandRegistry[]
  // The aws and vault logins still logged out, by identity
  loggedOut: Set<string>
  failed: string[]
  newTokens: number
}

// Logs in to a session that is logged out, or again when forced. Without
// a terminal, or from the dashboard, it only says what to run.
const logInSession = async (entry: SessionEntry, run: Run) => {
  const { type, login } = entry
  type.configure?.(login)
  const status = await sessionStatus(type, login)
  if (status.state === 'logged-in' && !run.force) {
    loginLine(entry, loggedInAs(status.detail))
    return
  }
  const fail = (why: string) => {
    logger.warn(`${titleOf(entry)}: ${why}`)
    run.loggedOut.add(login.identity)
    run.failed.push(refOf(entry))
  }
  if (status.state === 'no-cli') {
    return fail(`the ${type.cli.binary} CLI is not installed`)
  }
  if (!canLogIn()) {
    return fail(
      `${status.state === 'logged-in' ? 'logged in' : 'logged out'}. Run \`${LOGIN_COMMAND} ${refOf(entry)}\` in your own terminal: it opens a browser or asks for a password.`,
    )
  }
  if (
    status.state !== 'logged-in' &&
    !run.force &&
    !(await askConfirm(`${titleOf(entry)}: logged out. Log in now?`, true))
  ) {
    return fail('logged out')
  }
  try {
    const done = await logInToSession(type, login)
    const after = await sessionStatus(type, login)
    if (!done || after.state !== 'logged-in') {
      const help = type.help(login.config)
      return fail(`not logged in.${help ? ` ${help}` : ''}`)
    }
    loginLine(entry, loggedInAs(after.detail), true)
  } catch (error) {
    fail(messageOf(error))
  }
}

// Asks for a registry login that Dockhand lacks, or again when forced
const logInRegistry = async (entry: RegistryEntry, run: Run) => {
  const { host } = entry.login.config
  const saved = findLogin(run.registries, host)
  if (saved && !run.force) {
    loginLine(entry, `logged in as ${saved.username}`)
    return
  }
  if (!run.options.passwordStdin && !canAsk()) {
    logger.warn(
      `${titleOf(entry)}: no login. Run \`${LOGIN_COMMAND} ${refOf(entry)}\` in a terminal, or give --username and --password-stdin.`,
    )
    run.failed.push(refOf(entry))
    return
  }
  const { username, password } = await readRegistryLogin(
    entry,
    saved,
    run.options,
  )
  try {
    await logInToRegistry(host, username, password)
    loginLine(entry, `logged in as ${username}`, true)
  } catch (error) {
    logger.warn(`${titleOf(entry)}: ${messageOf(error)}`)
    run.failed.push(refOf(entry))
  }
}

// A new token for a registry whose login gets them, when the one in Dockhand
// has lived half of its life, as on start; always for a named login
const refreshToken = async (entry: RegistryEntry, run: Run) => {
  const { registries: tokenRegistries, problems } = listTokenRegistries()
  const registry = tokenRegistries.find(
    ({ host }) => host === entry.login.config.host,
  )
  const fail = (why: string) => {
    logger.warn(`${titleOf(entry)}: ${why}`)
    run.failed.push(refOf(entry))
  }
  if (!registry) {
    return fail(
      problems.find((problem) =>
        problem.includes(`(${entry.login.config.host})`),
      ) ?? 'its login is missing',
    )
  }
  // Its login was asked above: not twice
  if (run.loggedOut.has(registry.login.identity)) {
    return fail(
      `no new token: ${loginRef(registry.login.source, registry.login.name)} is logged out`,
    )
  }
  try {
    const done = await refreshRegistryToken(registry, {
      registries: run.registries,
      force: run.force,
    })
    if (done === 'fresh') {
      loginLine(
        entry,
        tokenState(
          entry.login.config.host,
          loginRef(registry.login.source, registry.login.name),
        ),
      )
      return
    }
    loginLine(
      entry,
      `new token from ${loginRef(registry.login.source, registry.login.name)}`,
      true,
    )
    run.newTokens += 1
  } catch (error) {
    fail(messageOf(error))
  }
}

export const loginCommand = new Command('login')
  .description(
    'Make the logins of the sources work: AWS and Vault sessions, registry logins and tokens in Dockhand. Named logins are logged in to again.',
  )
  .argument(
    '[logins...]',
    'Logins to log in to again, as <source>/<name> (or <name> when one source has it). Default: every login that does not work.',
  )
  .option(
    '-u, --username <username>',
    'Username on the registry, for one registry login',
  )
  .option(
    '--password-stdin',
    'Read the registry token from stdin, not from a prompt',
    false,
  )
  .action(
    withErrors(async (refs: string[], options: LoginOptions) => {
      const named = refs.length > 0
      const entries = named ? resolveRefs(refs) : allEntries()
      if (entries.length === 0) {
        logger.info('No source needs a login')
        return
      }
      if (options.passwordStdin || options.username) {
        const [entry] = entries
        if (
          !named ||
          entries.length !== 1 ||
          entry!.kind !== 'registry' ||
          entry!.login.config.login
        ) {
          throw new Error(
            `--username and --password-stdin are for one registry login that you type: \`${LOGIN_COMMAND} <source>/<name> -u <username> --password-stdin\`.`,
          )
        }
      }

      const sessions = entries.filter(
        (entry): entry is SessionEntry => entry.kind === 'session',
      )
      const registryEntries = entries.filter(
        (entry): entry is RegistryEntry => entry.kind === 'registry',
      )
      const run: Run = {
        force: named,
        options,
        registries: registryEntries.length > 0 ? await getRegistries() : [],
        loggedOut: new Set(),
        failed: [],
        newTokens: 0,
      }

      // The accounts first: the registry tokens come from them
      if (sessions.length > 0) {
        logger.group('Accounts')
        await installClis(sessions.map(({ type }) => type))
        for (const entry of sessions) await logInSession(entry, run)
      }
      if (registryEntries.length > 0) logger.group('Registries')
      // Typed logins first, then the tokens
      for (const entry of registryEntries) {
        if (!entry.login.config.login) await logInRegistry(entry, run)
      }
      for (const entry of registryEntries) {
        if (entry.login.config.login) await refreshToken(entry, run)
      }

      if (run.failed.length > 0) {
        throw new Error(`Not logged in: ${run.failed.join(', ')}.`)
      }
      // Last, in green, in place of "Done"
      closeFrameWithCallout(
        'success',
        [
          named ? 'Logged in' : 'All logins work',
          ...(run.newTokens > 0
            ? [
                'New ECR token saved. `local-env update` pulls the latest images with it now.',
              ]
            : []),
        ].join('\n'),
        { tinted: true },
      )
    }),
  )

// Logs out of a login: its registry login in Dockhand, or its session
const logOut = async (entry: Entry, registries: DockhandRegistry[]) => {
  if (entry.kind === 'registry') {
    const { host } = entry.login.config
    const registry = findHostRegistry(registries, host)
    if (!registry) {
      logger.info(`${titleOf(entry)}: no login in Dockhand`)
      return
    }
    await dockhandApi(`/registries/${registry.id}`, { method: 'DELETE' })
    // Docker keeps one login per host: the other sources lose it too
    const others =
      listDeclaredRegistries()
        .find((declared) => declared.host === host)
        ?.sources.filter((source) => source !== entry.login.source) ?? []
    logger.success(
      others.length > 0
        ? `Logged out of ${host}, also used by ${others.join(', ')}`
        : `Logged out of ${host}`,
    )
    return
  }
  const { type, login } = entry
  const status = await sessionStatus(type, login)
  if (status.state !== 'logged-in') {
    logger.info(`${titleOf(entry)}: not logged in`)
    return
  }
  if (!type.logoutCommand(login)) {
    logger.info(
      `${titleOf(entry)}: your own profile, local-env does not log out of it`,
    )
    return
  }
  if (!(await logOutOfSession(type, login))) {
    throw new Error(`Could not log out of ${titleOf(entry)}`)
  }
  logger.success(`Logged out of ${titleOf(entry)}`)
}

export const logoutCommand = new Command('logout')
  .description(
    'Log out of logins of the sources: a registry login in Dockhand, an AWS or Vault session',
  )
  .argument(
    '[logins...]',
    'Logins to log out of, as <source>/<name> (or <name> when one source has it). Default: pick one.',
  )
  .action(
    withErrors(async (refs: string[]) => {
      const needsDockhand = (entries: Entry[]) =>
        entries.some(({ kind }) => kind === 'registry')
      if (refs.length > 0) {
        const entries = resolveRefs(refs)
        const registries = needsDockhand(entries) ? await getRegistries() : []
        logger.group('Logins')
        for (const entry of entries) await logOut(entry, registries)
        return
      }

      const all = allEntries()
      const registries = needsDockhand(all) ? await getRegistries() : []
      // A registry login in Dockhand, or a session that may be open
      const candidates = all.filter(
        (entry) =>
          entry.kind === 'session' ||
          findHostRegistry(registries, entry.login.config.host) !== undefined,
      )
      if (candidates.length === 0) {
        logger.info('No login to log out of')
        return
      }
      if (!canAsk()) {
        throw new Error(
          'Name the login to log out of: `local-env logout <source>/<name>`',
        )
      }
      const picked = await askSelect(
        'Which login do you want to log out of?',
        candidates.map((entry) => ({
          value: refOf(entry),
          label: titleOf(entry),
        })),
      )
      logger.group('Logins')
      await logOut(
        candidates.find((entry) => refOf(entry) === picked)!,
        registries,
      )
    }),
  )
