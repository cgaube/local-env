import { isValidLoginName } from '#cli/logins/declared.js'
import { registryLogin } from '#cli/logins/registry.js'
import type { LoginType } from '#cli/logins/types.js'

// Every type of login. A new type is a file of logins/ and a line here. Only
// what works on any type's config is kept: each module uses its own type.
export const LOGIN_TYPES: Pick<LoginType<unknown>, 'type' | 'parse'>[] = [
  registryLogin,
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
