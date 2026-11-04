import { Command } from 'commander'
import { styleText } from 'node:util'
import { dockhandApi } from '#cli/providers/docker/api.js'
import {
  type DockhandRegistry,
  findHostRegistry,
  findLogin,
  getRegistries,
  listDeclaredRegistries,
  logInToRegistry,
  loginState,
  readSourceRegistries,
  registryHost,
  sourcesNeedingLogin,
  tokenQuestion,
  usernameQuestion,
} from '#cli/providers/docker/registries.js'
import { listSources } from '#cli/sources/sources.js'
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

// One line per source: its registries and the state of their login
const printLoginStates = (
  sources: string[],
  registries: DockhandRegistry[],
) => {
  const width = Math.max(...sources.map((source) => source.length))
  logger.log(
    sources
      .map((source) => {
        const states = readSourceRegistries(source).map(
          ({ host }) =>
            `${host} ${styleText('dim', loginState(registries, host))}`,
        )
        return `${source.padEnd(width)}  ${states.join(', ')}`
      })
      .join('\n'),
  )
}

const pickSource = (message: string, sources: string[]) =>
  askSelect(
    message,
    sources.map((value) => ({ value, label: value })),
  )

// The registries the source lists, or only the one --registry names
const sourceRegistries = (source: string, registry?: string) => {
  if (!listSources().includes(source)) {
    throw new Error(
      `No source named "${source}". See \`local-env sources list\`.`,
    )
  }
  const declared = readSourceRegistries(source)
  if (!registry) return declared
  const host = registryHost(registry)
  const match = declared.filter((entry) => entry.host === host)
  if (match.length === 0) {
    const hosts = declared.map((entry) => entry.host).join(', ')
    throw new Error(
      `${source} needs no login for ${host}${hosts ? `, only for ${hosts}` : ''}.`,
    )
  }
  return match
}

type LoginOptions = {
  registry?: string
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
      `${source} needs several registries (${hosts}): give --registry.`,
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
    'Log in to the registries of the private images of a source, saved in Dockhand',
  )
  .argument(
    '[name]',
    'Source name (default: list the sources that need a login, and pick one)',
  )
  .option('-r, --registry <host>', 'Only this registry of the source')
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
        const sources = sourcesNeedingLogin()
        if (sources.length === 0) {
          logger.info('No source needs a registry login')
          return
        }
        printLoginStates(sources, await getRegistries())
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

      const declared = sourceRegistries(source, options.registry)
      if (declared.length === 0) {
        logger.info(`${source} needs no registry login`)
        return
      }
      if (options.passwordStdin || !canAsk()) {
        await logInWithoutPrompts(source, declared, options)
        return
      }

      const registries = await getRegistries()
      for (const { host, usernameHelp, tokenHelp } of declared) {
        const login = findLogin(registries, host)
        // Asked again only when the user names the registry or agrees
        if (
          login &&
          !options.registry &&
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
  .description('Remove the registry logins of a source from Dockhand')
  .argument(
    '[name]',
    'Source name (default: pick from the sources with a login)',
  )
  .option('-r, --registry <host>', 'Only this registry of the source')
  .action(
    withErrors(
      async (given: string | undefined, options: { registry?: string }) => {
        const registries = await getRegistries()
        let source = given
        if (!source) {
          const sources = sourcesNeedingLogin().filter((name) =>
            readSourceRegistries(name).some(
              ({ host }) => findHostRegistry(registries, host) !== undefined,
            ),
          )
          if (sources.length === 0) {
            logger.info('No source has a registry login')
            return
          }
          printLoginStates(sources, registries)
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

        const declared = sourceRegistries(source, options.registry)
        if (declared.length === 0) {
          logger.info(`${source} needs no registry login`)
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
