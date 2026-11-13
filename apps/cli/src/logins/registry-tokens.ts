import { execa } from 'execa'
import { logger } from '#cli/utils/logger.js'
import { askConfirm } from '#cli/utils/prompt.js'
import type {
  DockhandStep,
  DockhandStepResult,
} from '#cli/providers/docker/types.js'
import {
  listAccounts,
  loginCommandFor,
  loginRef,
} from '#cli/logins/declared.js'
import { findSessionLogin, installClis } from '#cli/logins/prepare.js'
import {
  type DockhandRegistry,
  findHostRegistry,
  getRegistries,
  registryLogin,
  saveRegistryLogin,
} from '#cli/logins/registry.js'
import { canLogIn, logInToSession, sessionStatus } from '#cli/logins/session.js'
import { readRegistryToken, writeRegistryToken } from '#cli/logins/state.js'
import type {
  DeclaredLogin,
  RegistryTokenCommand,
  SessionLoginType,
} from '#cli/logins/types.js'

// The tokens of the registries that take no fixed login (AWS ECR)
// (docs/3-how-it-works/logins.md). Dockhand keeps a fixed username and
// password and has no hook before a pull, so it cannot ask a credential
// helper as the docker CLI does. A registry login with `login:` names a
// session login whose type can get a token (`registryToken`): local-env gets
// one with its CLI and saves it in Dockhand, on start, sources sync, deploy,
// install and update, and on `local-env login`.

// A registry whose tokens a session login gets
export type TokenRegistry = {
  host: string
  // The registry login, as the first source declares it
  name: string
  source: string
  // Every source that declares the host
  sources: string[]
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
  command: RegistryTokenCommand
}

// The token registries of the sources, and why some cannot get a token:
// their login is missing, gets no tokens, or does not serve the host
export const listTokenRegistries = () => {
  const registries: TokenRegistry[] = []
  const problems: string[] = []
  for (const { config, login: declared, sources } of listAccounts(
    registryLogin,
  )) {
    if (!config.login) continue
    const label = `${declared.source}: the registry ${declared.name} (${config.host})`
    const found = findSessionLogin(
      { label, source: declared.source },
      config.login,
      problems,
    )
    if (!found) continue
    if (!found.type.registryToken) {
      problems.push(
        `${label} names ${config.login}, a ${found.type.type} login, which gets no registry tokens.`,
      )
      continue
    }
    try {
      registries.push({
        host: config.host,
        name: declared.name,
        source: declared.source,
        sources,
        type: found.type,
        login: found.login,
        command: found.type.registryToken(found.login, config.host),
      })
    } catch (error) {
      problems.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}.`,
      )
    }
  }
  return { registries, problems }
}

// Dockhand has the token local-env saved, and it has more than half of its
// life left
const hasFreshToken = (
  { host, command }: TokenRegistry,
  registries: DockhandRegistry[],
  now: Date,
) => {
  const saved = findHostRegistry(registries, host)
  const token = readRegistryToken(host)
  if (!token || saved?.hasCredentials !== true) return false
  if (saved.username !== command.username) return false
  const half = (token.expiresAt.getTime() - token.savedAt.getTime()) / 2
  return now.getTime() < token.savedAt.getTime() + half
}

const sessionTitle = ({ type, login }: TokenRegistry) =>
  `${loginRef(login.source, login.name)} (${type.title(login.config)})`

const lastLine = (text: string) =>
  text.trim().split('\n').filter(Boolean).at(-1) ?? ''

// The session of the registry's login, logged in with the terminal when it
// can. Throws an Error that says how to log in.
const ensureSession = async (registry: TokenRegistry) => {
  const { type, login, host } = registry
  await installClis([type])
  type.configure?.(login)
  const status = await sessionStatus(type, login)
  if (status.state === 'logged-in') return
  if (status.state === 'no-cli') {
    throw new Error(
      `the ${type.cli.binary} CLI is not installed: brew install ${type.cli.formula}`,
    )
  }
  const help = type.help(login.config)
  const notLoggedIn = `${sessionTitle(registry)} is not logged in. Run \`${loginCommandFor(login.source, login.name)}\`.${help ? ` ${help}` : ''}`
  if (
    !canLogIn() ||
    !type.loginCommand(login) ||
    !(await askConfirm(
      `${sessionTitle(registry)}: not logged in, needed for the images of ${host}. Log in now?`,
      true,
    ))
  ) {
    throw new Error(notLoggedIn)
  }
  const done = await logInToSession(type, login)
  if (!done || (await sessionStatus(type, login)).state !== 'logged-in') {
    throw new Error(notLoggedIn)
  }
}

// A token of the host, with the login's session. It stays in memory, and
// only goes to Dockhand.
const getToken = async ({ type, login, command }: TokenRegistry) => {
  const [binary, ...args] = command.argv
  const result = await execa(binary!, args, {
    env: type.env(login),
    reject: false,
    stdin: 'ignore',
    timeout: 60_000,
  })
  if (result.exitCode !== 0) {
    throw new Error(
      lastLine(String(result.stderr)) ||
        `${binary} exited with ${result.exitCode}`,
    )
  }
  const token = String(result.stdout).trim()
  if (!token) throw new Error(`${binary} gave no token`)
  return token
}

// Saves a new token of the registry in Dockhand, unless the one it has has
// more than half of its life left (`force` gets one anyway). Throws an
// Error that says what to do.
export const refreshRegistryToken = async (
  registry: TokenRegistry,
  {
    registries,
    force = false,
    now = new Date(),
  }: { registries: DockhandRegistry[]; force?: boolean; now?: Date },
): Promise<'fresh' | 'refreshed'> => {
  if (!force && hasFreshToken(registry, registries, now)) return 'fresh'
  await ensureSession(registry)
  const token = await getToken(registry)
  await saveRegistryLogin(registry.host, registry.command.username, token)
  writeRegistryToken(registry.host, {
    savedAt: now,
    expiresAt: new Date(now.getTime() + registry.command.hours * 3_600_000),
  })
  return 'refreshed'
}

// Saves a new token in Dockhand for each token registry whose token has
// lived half of its life. A registry without one only gets a warning: start
// and sync go on, and only its private images do not pull.
export const registryTokensStep: DockhandStep = {
  name: 'Registry tokens',
  run: async (): Promise<DockhandStepResult> => {
    const { registries: tokenRegistries, problems } = listTokenRegistries()
    for (const problem of problems) logger.warn(problem)
    if (tokenRegistries.length === 0) return 'unchanged'

    const registries = await getRegistries()
    let changed = false
    for (const registry of tokenRegistries) {
      try {
        if (
          (await refreshRegistryToken(registry, { registries })) === 'fresh'
        ) {
          continue
        }
        logger.success(
          `${registry.host}: new token from ${loginRef(registry.login.source, registry.login.name)}`,
        )
        changed = true
      } catch (error) {
        logger.warn(
          `${registry.host}: no new token, the private images of ${registry.sources.join(', ')} may not pull. ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return changed ? 'updated' : 'unchanged'
  },
}
