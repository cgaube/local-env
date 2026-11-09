import type { Role } from '#services/dashboard/tools.js'
import { listSources } from '#cli/sources/sources.js'
import { logger } from '#cli/utils/logger.js'
import { askConfirm } from '#cli/utils/prompt.js'
import {
  ensureBrewInstalled,
  hasCommand,
  installBrewPackages,
} from '#cli/utils/brew.js'
import { awsLogin, pruneAwsConfig } from '#cli/logins/aws.js'
import { findSourceLogin, readSourceLogins } from '#cli/logins/declared.js'
import { SESSION_TYPES } from '#cli/logins/index.js'
import { registryLogin } from '#cli/logins/registry.js'
import {
  canLogIn,
  logInToSession,
  loginCommandFor,
  sessionStatus,
} from '#cli/logins/session.js'
import type { DeclaredLogin, SessionLoginType } from '#cli/logins/types.js'

// The logins that the roles of an install name (`logins:` of their
// local-env.yml), made ready before the playbook: the CLI installed and
// configured, the session checked, the login run with the terminal. Then
// given to Ansible in the extra var local_env_logins, by the name the roles
// use (docs/3-how-it-works/logins.md).

export type WantedLogin = {
  // As the roles name it: <login>, or <source>/<login>
  ref: string
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
  // The labels of the roles that name it
  roles: string[]
}

const TYPES = [...SESSION_TYPES, registryLogin]

// The login a role names: in the source it names, else in the role's own
// source first, then in any source
const findLogin = (role: Role, ref: string) => {
  const [named, name] = ref.includes('/')
    ? (ref.split('/') as [string, string])
    : [null, ref]
  const sources = named
    ? [named]
    : [role.source, ...listSources().filter((source) => source !== role.source)]
  for (const source of sources) {
    const found = findSourceLogin(source, name, TYPES)
    if (found) return found
  }
  return null
}

// The logins the roles name, once each. Throws an Error that lists every
// login that is missing, a registry, or a clash of names.
export const resolveRoleLogins = (roles: Role[]): WantedLogin[] => {
  const byRef = new Map<string, WantedLogin>()
  const problems: string[] = []
  for (const role of roles) {
    for (const ref of role.logins) {
      const found = findLogin(role, ref)
      if (!found) {
        problems.push(
          `${role.label} needs the login ${ref}, which no source declares.`,
        )
        continue
      }
      if (found.type === registryLogin) {
        problems.push(
          `${role.label} names ${ref}, a registry login: a role can name aws and vault logins only.`,
        )
        continue
      }
      const type = found.type as SessionLoginType<unknown>
      const existing = byRef.get(ref)
      if (!existing) {
        byRef.set(ref, { ref, type, login: found.login, roles: [role.label] })
        continue
      }
      // Extra vars are global: one name, one login for the whole run
      if (existing.login.identity !== found.login.identity) {
        problems.push(
          `${existing.roles[0]} and ${role.label} both name the login ${ref}, but it is another login for each (in ${existing.login.source} and in ${found.login.source}). Name its source in local-env.yml: ${found.login.source}/${found.login.name}.`,
        )
        continue
      }
      if (!existing.roles.includes(role.label)) existing.roles.push(role.label)
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return [...byRef.values()]
}

const sessionKey = ({ type, login }: WantedLogin) =>
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

// Logged in to the account, or throws before anything runs
const ensureSession = async (wanted: WantedLogin) => {
  const { type, login, roles } = wanted
  const title = `${login.name} (${type.title(login.config)})`
  const status = await sessionStatus(type, login)
  if (status.state === 'logged-in') {
    logger.success(
      `${title}: logged in ${status.detail.replace(/^logged in ?/, '')}`.trimEnd(),
    )
    return
  }
  if (status.state === 'no-cli') {
    throw new Error(
      `${title}: the ${type.cli.binary} CLI is still not installed. Nothing ran. Run \`brew install ${type.cli.formula}\`, then local-env install again.`,
    )
  }
  const help = type.help(login.config)
  const command = loginCommandFor(login.source, login.name)
  const needs = `needed by ${roles.join(', ')}`
  if (!canLogIn()) {
    throw new Error(
      `${title}: not logged in, ${needs}. Nothing ran. In a terminal: ${command}${help ? `\n${help}` : ''}`,
    )
  }
  if (
    !(await askConfirm(`${title}: not logged in, ${needs}. Log in now?`, true))
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
  logger.success(
    `${title}: logged in ${after.detail.replace(/^logged in ?/, '')}`.trimEnd(),
  )
}

// The AWS profiles local-env wrote for logins that no source declares any
// more go
export const pruneUnusedLogins = () =>
  pruneAwsConfig(
    listSources().flatMap((source) => readSourceLogins(source, awsLogin)),
  )

// Makes the logins of these roles ready, then gives local_env_logins: empty
// when no role names a login
export const prepareLogins = async (roles: Role[]) => {
  const wanted = resolveRoleLogins(roles)
  pruneUnusedLogins()
  if (wanted.length === 0) return {}

  logger.group('Logins')
  await installClis(wanted.map(({ type }) => type))
  const sessions = new Map(wanted.map((login) => [sessionKey(login), login]))
  for (const login of sessions.values()) {
    login.type.configure?.(login.login)
    await ensureSession(login)
  }
  return Object.fromEntries(
    wanted.map(({ ref, type, login }) => [
      ref,
      { type: type.type, ...type.facts(login), env: type.env(login) },
    ]),
  )
}
