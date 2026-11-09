import {
  optionalText,
  requiredText,
  type SessionLoginType,
} from '#cli/logins/types.js'

// A HashiCorp Vault, read by roles with the vault CLI:
//   data-vault:
//     type: vault
//     address: https://vault.data.acme.io
//     namespace: dev
//     method: oidc
//     role: developer
//     help: Ask #data for the developer role
// The CLI has no config file for the address: every call, and every task of
// the role, gets VAULT_ADDR (and VAULT_NAMESPACE). The token is the CLI's
// own, in ~/.vault-token.

export type VaultConfig = {
  address: string
  namespace?: string
  // The auth method of `vault login`
  method: string
  // Where the method is mounted, when not at its default path
  mount?: string
  // The role of the method (oidc, jwt)
  role?: string
  help?: string
}

export const vaultLogin: SessionLoginType<VaultConfig> = {
  type: 'vault',
  parse: (entry) => {
    const address = requiredText(entry, 'address').replace(/\/+$/, '')
    if (!/^https?:\/\/[^/\s]+/.test(address)) {
      throw new Error('address must be the URL of the Vault: https://…')
    }
    const method = optionalText(entry, 'method') ?? 'oidc'
    if (!/^[a-z0-9_-]+$/.test(method)) {
      throw new Error('method must be the name of an auth method: oidc, ldap…')
    }
    return {
      address,
      namespace: optionalText(entry, 'namespace'),
      method,
      mount: optionalText(entry, 'mount'),
      role: optionalText(entry, 'role'),
      help: optionalText(entry, 'help'),
    }
  },
  // One token per Vault and namespace
  identity: ({ address, namespace }) =>
    namespace ? `${address}#${namespace}` : address,
  title: ({ address, namespace }) =>
    `Vault ${address.replace(/^https?:\/\//, '')}${namespace ? ` (${namespace})` : ''}`,
  cli: { binary: 'vault', formula: 'hashicorp/tap/vault' },
  env: ({ config }) => ({
    VAULT_ADDR: config.address,
    ...(config.namespace ? { VAULT_NAMESPACE: config.namespace } : {}),
  }),
  statusCommand: () => ['vault', 'token', 'lookup', '-format=json'],
  describeSession: (stdout) => {
    try {
      const { data } = JSON.parse(stdout) as {
        data?: { display_name?: string }
      }
      return data?.display_name ? `as ${data.display_name}` : 'logged in'
    } catch {
      return 'logged in'
    }
  },
  loginCommand: ({ config }) => [
    'vault',
    'login',
    `-method=${config.method}`,
    ...(config.mount ? [`-path=${config.mount}`] : []),
    ...(config.role ? [`role=${config.role}`] : []),
  ],
  logoutCommand: () => ['vault', 'token', 'revoke', '-self'],
  help: ({ help }) => help,
  facts: ({ config }) => ({
    address: config.address,
    ...(config.namespace ? { namespace: config.namespace } : {}),
  }),
}
