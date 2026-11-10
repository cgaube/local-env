import { isRecord, optionalText, requiredText } from '#cli/logins/types.js'
import { isLoginRef } from '#services/dashboard/source-manifest.js'

// A secret of a source: in the `secrets` of its manifest, the variable it
// fills, and where its value is. A role of the source that declares that
// input, or asks for it, gets it; later, a Docker stack whose compose file
// uses the variable.
//   github_token:
//     login: acme-dev        # a login of a source manifest, or <source>/<login>
//     ref: platform/dev/github # the secret in that vault: an AWS secret id,
//                            # a Vault KV path
//     field: token           # a key of its JSON value (AWS), of the KV
//                            # entry (Vault)
// The login's type turns it into the command that reads the value
// (SessionLoginType.secretCommand). docs/3-how-it-works/logins.md.

export type SecretRef = {
  // As written: <login>, or <source>/<login>
  login: string
  ref: string
  field?: string
}

// The name of the variable it fills: an input of a role (github_token), a
// variable of a compose file (DB_PASSWORD). local_env and ansible_ are
// local-env's and Ansible's own.
export const isValidSecretName = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^(local_env|ansible_)/i.test(name)

// One entry of `secrets:`. Throws an Error that names the field.
export const parseSecretRef = (entry: unknown): SecretRef => {
  if (!isRecord(entry)) throw new Error('must be a mapping with login and ref')
  const login = requiredText(entry, 'login')
  if (!isLoginRef(login)) {
    throw new Error('login must be the name of a login, or <source>/<login>')
  }
  const field = optionalText(entry, 'field')
  return {
    login,
    ref: requiredText(entry, 'ref'),
    ...(field ? { field } : {}),
  }
}

// Every entry of `secrets:`, by name, and a problem for each that is not
// valid, as `secrets.<name>: <why>`
export const parseSecretRefs = (secrets: Record<string, unknown>) => {
  const valid: Record<string, SecretRef> = {}
  const problems: string[] = []
  for (const [name, entry] of Object.entries(secrets)) {
    if (!isValidSecretName(name)) {
      problems.push(
        `secrets.${name}: a secret is named after the variable it fills: letters, digits and _, not first a digit, and not local_env… or ansible_…`,
      )
      continue
    }
    if (!isRecord(entry)) {
      problems.push(`secrets.${name} must be a mapping with login and ref`)
      continue
    }
    try {
      valid[name] = parseSecretRef(entry)
    } catch (error) {
      problems.push(
        `secrets.${name}.${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { secrets: valid, problems }
}
