import type { Role } from '#services/dashboard/tools.js'
import { listSources } from '#cli/sources/sources.js'
import { logger } from '#cli/utils/logger.js'
import { awsLogin, pruneAwsConfig } from '#cli/logins/aws.js'
import { readSourceLogins } from '#cli/logins/declared.js'
import {
  ensureSessions,
  findSessionLogin,
  readSecrets,
  resolveSecret,
  sameSecret,
  type SessionEntry,
  sourceSecrets,
  type WantedSecret,
} from '#cli/logins/prepare.js'

// The logins and the secrets of the roles of an install, before the
// playbook. A role gets the secrets of its own source that it declares as
// inputs (meta/argument_specs.yml) or asks for in its local-env.yml
// (`Role.secrets`), and names the logins it runs the CLI with (`logins:`).
// prepare.ts makes them ready and reads the secrets; this file adds what
// Ansible needs: its variables are global, so one name is one login and one
// secret for the whole run (docs/3-how-it-works/logins.md).

export type WantedLogin = SessionEntry & {
  // As the roles name it: <login>, or <source>/<login>
  ref: string
  // The labels of the roles that name it
  roles: string[]
}

// The logins the roles name and the secrets they get. `passed` holds, by role
// id, the variables that a role of the run passes to it (`vars:`): their
// value wins, so they are not read. Throws an Error that lists every problem:
// a login missing or of another type, a secret that its source does not give,
// one name for two logins or two secrets.
export const resolveRoleLogins = (
  roles: Role[],
  passed: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): { logins: WantedLogin[]; secrets: WantedSecret[] } => {
  const secretsOf = sourceSecrets()
  const byRef = new Map<string, WantedLogin>()
  const byName = new Map<string, WantedSecret>()
  const problems: string[] = []
  for (const role of roles) {
    for (const ref of role.logins) {
      const found = findSessionLogin(role, ref, problems)
      if (!found) continue
      const existing = byRef.get(ref)
      if (!existing) {
        byRef.set(ref, { ...found, ref, roles: [role.label] })
        continue
      }
      if (existing.login.identity !== found.login.identity) {
        problems.push(
          `${existing.roles[0]} and ${role.label} both name the login ${ref}, but it is another login for each (in ${existing.login.source} and in ${found.login.source}). Name its source in local-env.yml: ${found.login.source}/${found.login.name}.`,
        )
        continue
      }
      if (!existing.roles.includes(role.label)) existing.roles.push(role.label)
    }

    for (const name of role.secrets) {
      if (passed.get(role.id)?.has(name)) continue
      const wanted = resolveSecret(role, name, secretsOf, problems)
      if (!wanted) continue
      const other = byName.get(name)
      if (!other) {
        byName.set(name, wanted)
      } else if (!sameSecret(other, wanted)) {
        problems.push(
          `${other.consumer.label} (${other.consumer.source}) and ${role.label} (${role.source}) both get ${name} from the secrets of their source, but another secret for each: Ansible's variables are global. Rename it in one of the sources.`,
        )
      }
    }
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return { logins: [...byRef.values()], secrets: [...byName.values()] }
}

// The AWS profiles local-env wrote for logins that no source declares any
// more go
export const pruneUnusedLogins = () =>
  pruneAwsConfig(
    listSources().flatMap((source) => readSourceLogins(source, awsLogin)),
  )

// Makes the logins of these roles ready and reads their secrets, then gives
// what Ansible gets: the logins (local_env.logins) and the value of each
// secret by its name, each empty when no role needs one
export const prepareLogins = async (
  roles: Role[],
  passed: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
) => {
  const { logins, secrets } = resolveRoleLogins(roles, passed)
  pruneUnusedLogins()
  if (logins.length === 0 && secrets.length === 0) {
    return { logins: {}, secrets: {} }
  }

  logger.group('Logins')
  await ensureSessions([
    ...logins.map(({ type, login, roles: needs }) => ({ type, login, needs })),
    ...secrets.map(({ type, login, consumer }) => ({
      type,
      login,
      needs: [consumer.label],
    })),
  ])
  const values =
    secrets.length > 0 ? await readSecrets(secrets, 'the tools') : {}
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
