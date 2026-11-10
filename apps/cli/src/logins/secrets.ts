import { isRecord, optionalText, requiredText } from '#cli/logins/types.js'

// A secret that a role reads (the `secrets:` of its local-env.yml), and,
// later, that a Docker stack gets: a name, and where the value is.
//   STRIPE_KEY:
//     login: acme-dev        # a login of a source manifest, or <source>/<login>
//     ref: billing/dev       # the secret in that vault: an AWS secret id, a
//                            # Vault KV path
//     field: stripe_key      # a key of its JSON value (AWS), of the KV entry
//                            # (Vault)
// The login's type turns it into the command that reads the value
// (SessionLoginType.secretCommand). docs/3-how-it-works/logins.md.

export type SecretRef = {
  // As written: <login>, or <source>/<login>
  login: string
  ref: string
  field?: string
}

// One way to name a secret, in a role and in a stack: an environment
// variable, which compose reads as ${STRIPE_KEY}
export const isValidSecretName = (name: string) =>
  /^[A-Z][A-Z0-9_]*$/.test(name)

const LOGIN_REF = /^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/

// One entry of `secrets:`. Throws an Error that names the field.
export const parseSecretRef = (entry: unknown): SecretRef => {
  if (!isRecord(entry)) throw new Error('must be a mapping with login and ref')
  const login = requiredText(entry, 'login')
  if (!LOGIN_REF.test(login)) {
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
        `secrets.${name}: a secret name is uppercase letters, digits and _, like an environment variable (STRIPE_KEY)`,
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
