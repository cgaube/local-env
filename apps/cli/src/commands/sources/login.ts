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
import { sourceLoginLines, sourcesWithAnyLogin } from '#cli/logins/listing.js'
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

// The registries of the source, or only the one --login names
const sourceLogins = (source: string, login?: string) => {
  if (!listSources().includes(source)) {
    throw new Error(
      `No source named "${source}". See \`local-env sources list\`.`,
    )
  }
  const registries = readSourceRegistries(source)
  if (!login) return registries
  const match = registries.filter((entry) => entry.name === login)
  if (match.length === 0) {
    const names = registries.map(({ name }) => name).join(', ')
    throw new Error(
      `${source} has no login named "${login}"${names ? `, only ${names}` : ''}.`,
    )
  }
  return match
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
    'Log in to the registries of a source: the logins are saved in Dockhand',
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

      const declared = sourceLogins(source, options.login)
      if (declared.length === 0) {
        logger.info(`${source} needs no login`)
        return
      }
      if (options.passwordStdin || !canAsk()) {
        await logInWithoutPrompts(source, declared, options)
        return
      }

      const registries = await getRegistries()
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
    }),
  )

export const logoutCommand = new Command('logout')
  .description(
    'Log out of the registries of a source: removes their logins from Dockhand',
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
          // A registry login in Dockhand
          const sources = sourcesWithAnyLogin().filter((name) =>
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

        const declared = sourceLogins(source, options.login)
        if (declared.length === 0) {
          logger.info(`${source} needs no login`)
          return
        }
        logger.group('Registries')
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
      },
    ),
  )
