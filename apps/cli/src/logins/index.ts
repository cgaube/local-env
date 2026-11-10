import { awsLogin } from '#cli/logins/aws.js'
import { isValidLoginName } from '#cli/logins/declared.js'
import { parseSecretRefs } from '#cli/logins/secrets.js'
import { registryLogin } from '#cli/logins/registry.js'
import type { LoginType, SessionLoginType } from '#cli/logins/types.js'
import { vaultLogin } from '#cli/logins/vault.js'

// The types whose session a vendor CLI keeps: roles name them
export const SESSION_TYPES: SessionLoginType<any>[] = [awsLogin, vaultLogin]

// Every type of login. A new type is a file of logins/ and a line here. Only
// what works on any type's config is kept: each module uses its own type.
export const LOGIN_TYPES: Pick<LoginType<unknown>, 'type' | 'parse'>[] = [
  registryLogin,
  ...SESSION_TYPES,
]

const findType = (type: unknown) =>
  LOGIN_TYPES.find((candidate) => candidate.type === type)

// Checks the `logins` of a manifest, for `sources add`. Throws an Error that
// names the login and the field.
export const checkManifestLogins = (logins: Record<string, unknown>) => {
  for (const [name, entry] of Object.entries(logins)) {
    const where = `logins.${name}`
    if (!isValidLoginName(name)) {
      throw new Error(
        `${where}: a login name is lowercase letters, digits and dashes`,
      )
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${where} must be a mapping with a type`)
    }
    const { type } = entry as Record<string, unknown>
    const loginType = findType(type)
    if (!loginType) {
      throw new Error(
        `${where}.type must be one of ${LOGIN_TYPES.map((known) => known.type).join(', ')} (${type === undefined ? 'missing' : JSON.stringify(type)})`,
      )
    }
    try {
      loginType.parse(entry as Record<string, unknown>)
    } catch (error) {
      throw new Error(
        `${where}.${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

// Checks the `logins` and the `secrets` of a manifest, for `sources add` and
// `doctor`. Throws an Error that names the first entry that is not valid.
export const checkManifest = ({
  logins,
  secrets,
}: {
  logins: Record<string, unknown>
  secrets: Record<string, unknown>
}) => {
  checkManifestLogins(logins)
  const [problem] = parseSecretRefs(secrets).problems
  if (problem) throw new Error(problem)
}
