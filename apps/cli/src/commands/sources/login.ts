import { Command } from 'commander'
import { dockhandApi } from '#cli/providers/docker/api.js'
import {
  type DockhandRegistry,
  findHostRegistry,
  findLogin,
  getRegistries,
  listDeclaredRegistries,
  logInToRegistry,
  readSourceRegistries,
  sourcesNeedingLogin,
  tokenQuestion,
  usernameQuestion,
} from '#cli/logins/registry.js'
import { describeSource, listSources } from '#cli/sources/sources.js'
import {
  type SessionEntry,
  sourceLoginLines,
  sourceSessionLogins,
  sourcesWithAnyLogin,
} from '#cli/logins/listing.js'
import {
  canLogIn,
  logInToSession,
  logOutOfSession,
  sessionStatus,
} from '#cli/logins/session.js'
import { installClis } from '#cli/logins/prepare.js'
import { logger } from '#cli/utils/index.js'
import {
  askConfirm,
  askPassword,
  askSelect,
  askText,
  canAsk,
} from '#cli/utils/prompt.js'

const withErrors =
  <A extends unknown[]>(action: (...args: A) => Promise<void>) =>
  async (...args: A) => {
    try {
      await action(...args)
    } catch (error) {
      logger.error('Sources failed:', error)
      process.exit(1)
    }
  }

const readStdin = async () => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

// A group per source: a line per login, with its state
const printLoginStates = async (
  sources: string[],
  registries: DockhandRegistry[],
) => {
  for (const source of sources) {
    logger.group(describeSource(source))
    logger.log((await sourceLoginLines(source, registries)).join('\n'))
  }
}

const pickSource = (message: string, sources: string[]) =>
  askSelect(
    message,
    sources.map((value) => ({ value, label: value })),
  )

// The logins of the source, or only the one --login names: its registries
// and its aws and vault logins
const sourceLogins = (source: string, login?: string) => {
  if (!listSources().includes(source)) {
    throw new Error(
      `No source named "${source}". See \`local-env sources list\`.`,
    )
  }
  const registries = readSourceRegistries(source)
  const sessions = sourceSessionLogins(source)
  if (!login) return { registries, sessions }
  const match = {
    registries: registries.filter((entry) => entry.name === login),
    sessions: sessions.filter((entry) => entry.login.name === login),
  }
  if (match.registries.length + match.sessions.length === 0) {
    const names = [
      ...registries.map(({ name }) => name),
      ...sessions.map(({ login }) => login.name),
    ].join(', ')
    throw new Error(
      `${source} has no login named "${login}"${names ? `, only ${names}` : ''}.`,
    )
  }
  return match
}

const sessionTitle = ({ type, login }: SessionEntry) =>
  `${login.name} (${type.title(login.config)})`

const loggedInAs = (detail: string) =>
  `logged in ${detail.replace(/^logged in ?/, '')}`.trimEnd()

// Logs in to these aws and vault logins with their CLI, which gets the
// terminal. One that is logged in is asked again only when --login named it.
const logInToSessions = async (sessions: SessionEntry[], named: boolean) => {
  if (sessions.length === 0) return
  if (!canLogIn()) {
    throw new Error(
      `Log in to ${sessions.map(sessionTitle).join(', ')} in your own terminal: it opens a browser or asks for a password.`,
    )
  }
  logger.group('Logins')
  await installClis(sessions.map(({ type }) => type))
  for (const entry of sessions) {
    const { type, login } = entry
    type.configure?.(login)
    const status = await sessionStatus(type, login)
    if (
      status.state === 'logged-in' &&
      !named &&
      !(await askConfirm(
        `${sessionTitle(entry)}: ${loggedInAs(status.detail)}. Log in again?`,
        false,
      ))
    ) {
      continue
    }
    const done = await logInToSession(type, login)
    const after = await sessionStatus(type, login)
    if (!done || after.state !== 'logged-in') {
      const help = type.help(login.config)
      throw new Error(
        `${sessionTitle(entry)}: not logged in.${help ? ` ${help}` : ''}`,
      )
    }
    logger.success(`${sessionTitle(entry)}: ${loggedInAs(after.detail)}`)
  }
}

// Logs out of these aws and vault logins, when logged in
const logOutOfSessions = async (sessions: SessionEntry[]) => {
  if (sessions.length === 0) return
  logger.group('Logins')
  for (const entry of sessions) {
    const status = await sessionStatus(entry.type, entry.login)
    if (status.state !== 'logged-in') {
      logger.info(`${sessionTitle(entry)}: not logged in`)
      continue
    }
    if (!entry.type.logoutCommand(entry.login)) {
      logger.info(
        `${sessionTitle(entry)}: your own profile, local-env does not log out of it`,
      )
      continue
    }
    if (await logOutOfSession(entry.type, entry.login)) {
      logger.success(`Logged out of ${sessionTitle(entry)}`)
    } else {
      throw new Error(`Could not log out of ${sessionTitle(entry)}`)
    }
  }
}

type LoginOptions = {
  login?: string
  username?: string
  passwordStdin: boolean
}

// Without a terminal: one registry, the username and the token from stdin
const logInWithoutPrompts = async (
  source: string,
  declared: ReturnType<typeof readSourceRegistries>,
  options: LoginOptions,
) => {
  if (!options.username || !options.passwordStdin) {
    throw new Error(
      'Give --username and --password-stdin to log in without a terminal.',
    )
  }
  if (declared.length > 1) {
    const hosts = declared.map((entry) => entry.host).join(', ')
    throw new Error(
      `${source} needs several registries (${hosts}): give --login.`,
    )
  }
  const { host } = declared[0]!
  const username = options.username.trim()
  // Never on the command line: other processes can read it there
  const password = await readStdin()
  logger.group('Registries')
  await logInToRegistry(host, username, password)
  logger.success(`Logged in to ${host} as ${username}`)
}

export const loginCommand = new Command('login')
  .description(
    'Log in to the logins of a source: registries (saved in Dockhand), AWS and Vault (with their CLI)',
  )
  .argument(
    '[name]',
    'Source name (default: list the sources that need a login, and pick one)',
  )
  .option(
    '-l, --login <name>',
    'Only this login of the source (its name in local-env.yml)',
  )
  .option('-u, --username <username>', 'Username on the registry')
  .option(
    '--password-stdin',
    'Read the token from stdin, not from a prompt',
    false,
  )
  .action(
    withErrors(async (given: string | undefined, options: LoginOptions) => {
      let source = given
      if (!source) {
        const sources = sourcesWithAnyLogin()
        if (sources.length === 0) {
          logger.info('No source needs a login')
          return
        }
        await printLoginStates(
          sources,
          sourcesNeedingLogin().length > 0 ? await getRegistries() : [],
        )
        if (!canAsk() || options.passwordStdin) {
          logger.info(
            'Name the source to log in to: `local-env sources login <name>`',
          )
          return
        }
        source = await pickSource(
          'Which source do you want to log in to?',
          sources,
        )
      }

      const { registries: declared, sessions } = sourceLogins(
        source,
        options.login,
      )
      if (declared.length + sessions.length === 0) {
        logger.info(`${source} needs no login`)
        return
      }
      if (declared.length > 0 && (options.passwordStdin || !canAsk())) {
        await logInWithoutPrompts(source, declared, options)
        return
      }

      const registries = declared.length > 0 ? await getRegistries() : []
      for (const { host, usernameHelp, tokenHelp } of declared) {
        const login = findLogin(registries, host)
        // Asked again only when the user names the login or agrees
        if (
          login &&
          !options.login &&
          !(await askConfirm(
            `${host}: logged in as ${login.username}. Log in again?`,
            false,
          ))
        ) {
          continue
        }
        const username = (
          options.username ??
          (await askText(
            usernameQuestion(host, usernameHelp),
            login?.username ?? '',
          ))
        ).trim()
        const password = (
          await askPassword(tokenQuestion(host, tokenHelp))
        ).trim()
        logger.group('Registries')
        await logInToRegistry(host, username, password)
        logger.success(`Logged in to ${host} as ${username}`)
      }
      await logInToSessions(sessions, Boolean(options.login))
    }),
  )

export const logoutCommand = new Command('logout')
  .description(
    'Log out of the logins of a source: its registries in Dockhand, its AWS and Vault sessions',
  )
  .argument(
    '[name]',
    'Source name (default: pick from the sources with a login)',
  )
  .option(
    '-l, --login <name>',
    'Only this login of the source (its name in local-env.yml)',
  )
  .action(
    withErrors(
      async (given: string | undefined, options: { login?: string }) => {
        // Dockhand only when a source has a registry
        const registries =
          sourcesNeedingLogin().length > 0 ? await getRegistries() : []
        let source = given
        if (!source) {
          // A registry login in Dockhand, or an aws or vault login that may
          // have a session
          const sources = sourcesWithAnyLogin().filter(
            (name) =>
              sourceSessionLogins(name).length > 0 ||
              readSourceRegistries(name).some(
                ({ host }) => findHostRegistry(registries, host) !== undefined,
              ),
          )
          if (sources.length === 0) {
            logger.info('No source has a login')
            return
          }
          await printLoginStates(sources, registries)
          if (!canAsk()) {
            throw new Error(
              'Name the source to log out of: `local-env sources logout <name>`',
            )
          }
          source = await pickSource(
            'Which source do you want to log out of?',
            sources,
          )
        }

        const { registries: declared, sessions } = sourceLogins(
          source,
          options.login,
        )
        if (declared.length + sessions.length === 0) {
          logger.info(`${source} needs no login`)
          return
        }
        if (declared.length > 0) logger.group('Registries')
        for (const { host } of declared) {
          const registry = findHostRegistry(registries, host)
          if (!registry) {
            logger.info(`${host}: no login in Dockhand`)
            continue
          }
          await dockhandApi(`/registries/${registry.id}`, { method: 'DELETE' })
          // Docker keeps one login per host: the other sources lose it too
          const others =
            listDeclaredRegistries()
              .find((entry) => entry.host === host)
              ?.sources.filter((name) => name !== source) ?? []
          logger.success(
            others.length > 0
              ? `Logged out of ${host}, also used by ${others.join(', ')}`
              : `Logged out of ${host}`,
          )
        }
        await logOutOfSessions(sessions)
      },
    ),
  )
