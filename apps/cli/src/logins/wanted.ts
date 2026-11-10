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
  readSecret,
  sessionStatus,
} from '#cli/logins/session.js'
import { parseSecretRefs, type SecretRef } from '#cli/logins/secrets.js'
import type { DeclaredLogin, SessionLoginType } from '#cli/logins/types.js'

// The logins that the roles of an install need, made ready before the
// playbook: the CLI installed and configured, the session checked, the login
// run with the terminal. A role needs a login when it reads a secret of it
// (`secrets:` of its local-env.yml), or names it to run the CLI itself
// (`logins:`). Then the secrets are read, and given to Ansible with the
// logins: local_env_secrets, the value of each secret by its name, and
// local_env_logins, the environment of each login the roles name
// (docs/3-how-it-works/logins.md).

export type WantedLogin = {
  // As the roles name it: <login>, or <source>/<login>
  ref: string
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
  // The labels of the roles that name it
  roles: string[]
}

export type WantedSecret = {
  role: Role
  name: string
  secret: SecretRef
  type: SessionLoginType<any>
  login: DeclaredLogin<unknown>
  command: { argv: string[]; keys: string[] }
}

type Found = { type: SessionLoginType<any>; login: DeclaredLogin<unknown> }

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

// A login of an aws or vault type, or a problem
const findSessionLogin = (
  role: Role,
  ref: string,
  problems: string[],
): Found | null => {
  const found = findLogin(role, ref)
  if (!found) {
    problems.push(
      `${role.label} needs the login ${ref}, which no source declares.`,
    )
    return null
  }
  if (found.type === registryLogin) {
    problems.push(
      `${role.label} names ${ref}, a registry login: a role can use aws and vault logins only.`,
    )
    return null
  }
  return found as Found
}

// The logins the roles name and the secrets they read. Throws an Error that
// lists every problem: a login missing or of the wrong type, a secret that is
// not valid, a clash of names.
export const resolveRoleLogins = (
  roles: Role[],
): { logins: WantedLogin[]; secrets: WantedSecret[] } => {
  const byRef = new Map<string, WantedLogin>()
  const secrets: WantedSecret[] = []
  const problems: string[] = []
  // Extra vars are global: one secret name, one secret for the whole run
  const byName = new Map<string, WantedSecret>()
  for (const role of roles) {
    for (const ref of role.logins) {
      const found = findSessionLogin(role, ref, problems)
      if (!found) continue
      const existing = byRef.get(ref)
      if (!existing) {
        byRef.set(ref, { ref, ...found, roles: [role.label] })
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

    const declared = parseSecretRefs(role.secrets)
    for (const problem of declared.problems) {
      problems.push(`${role.label}: local-env.yml: ${problem}`)
    }
    for (const [name, secret] of Object.entries(declared.secrets)) {
      const found = findSessionLogin(role, secret.login, problems)
      if (!found) continue
      try {
        const command = found.type.secretCommand(found.login, secret)
        const wanted = { role, name, secret, ...found, command }
        const other = byName.get(name)
        if (!other) {
          byName.set(name, wanted)
          secrets.push(wanted)
        } else if (
          other.login.identity !== found.login.identity ||
          other.secret.ref !== secret.ref ||
          other.secret.field !== secret.field
        ) {
          problems.push(
            `${other.role.label} and ${role.label} both read a secret named ${name}, but another one for each. Give one of them another name.`,
          )
        }
      } catch (error) {
        problems.push(
          `${role.label}: local-env.yml: secrets.${name}.${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return { logins: [...byRef.values()], secrets }
}

const sessionKey = ({ type, login }: Found) => `${type.type}:${login.identity}`

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
const ensureSession = async (wanted: Found & { roles: string[] }) => {
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

// What a secret is called in the messages
const secretTitle = ({ name, secret, login }: WantedSecret) =>
  `${name} (${secret.ref}${secret.field ? ` ${secret.field}` : ''}, ${login.name})`

// The value of each secret, by name, read once the sessions are ready.
// Throws an Error that names every secret that could not be read, before
// anything runs.
const readSecrets = async (secrets: WantedSecret[]) => {
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
          `${wanted.role.label}: the secret ${secretTitle(wanted)} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),
  )
  if (problems.length > 0) {
    throw new Error(`${problems.sort().join('\n')}\nNothing ran.`)
  }
  logger.success(
    `Read ${secrets.length === 1 ? 'the secret' : `${secrets.length} secrets`} of the tools: ${secrets.map(({ name }) => name).join(', ')}`,
  )
  // In the order the roles declare them
  return Object.fromEntries(secrets.map(({ name }) => [name, values[name]!]))
}

// Makes the logins of these roles ready and reads their secrets, then gives
// what Ansible gets: local_env_logins and local_env_secrets, each empty when
// no role needs one
export const prepareLogins = async (roles: Role[]) => {
  const { logins, secrets } = resolveRoleLogins(roles)
  pruneUnusedLogins()
  if (logins.length === 0 && secrets.length === 0) {
    return { logins: {}, secrets: {} }
  }

  logger.group('Logins')
  // Each account once, with the roles that need it
  const sessions = new Map<string, Found & { roles: string[] }>()
  for (const { type, login, roles: names } of logins) {
    const key = sessionKey({ type, login })
    const session = sessions.get(key) ?? { type, login, roles: [] }
    session.roles.push(...names.filter((name) => !session.roles.includes(name)))
    sessions.set(key, session)
  }
  for (const { type, login, role } of secrets) {
    const key = sessionKey({ type, login })
    const session = sessions.get(key) ?? { type, login, roles: [] }
    if (!session.roles.includes(role.label)) session.roles.push(role.label)
    sessions.set(key, session)
  }
  await installClis([...sessions.values()].map(({ type }) => type))
  for (const session of sessions.values()) {
    session.type.configure?.(session.login)
    await ensureSession(session)
  }

  const values = secrets.length > 0 ? await readSecrets(secrets) : {}
  return {
    logins: Object.fromEntries(
      logins.map(({ ref, type, login }) => [
        ref,
        { type: type.type, ...type.facts(login), env: type.env(login) },
      ]),
    ),
    secrets: values,
  }
}
