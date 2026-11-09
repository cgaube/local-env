import { awsLogin, awsProfile, ssoSessionName } from '#cli/logins/aws.js'
import { vaultLogin } from '#cli/logins/vault.js'

const SSO = {
  startUrl: 'https://acme.awsapps.com/start',
  region: 'eu-west-1',
  accountId: '123456789012',
  roleName: 'Dev',
}

describe('the aws login', () => {
  test('reads an account id that YAML read as a number', () => {
    const config = awsLogin.parse({
      type: 'aws',
      sso: { ...SSO, accountId: 123456789012 },
    })

    expect(config.sso?.accountId).toBe('123456789012')
  })

  test.each([
    [{ type: 'aws' }, 'sso or profile is required'],
    [{ type: 'aws', sso: SSO, profile: 'mine' }, 'give one of them'],
    [
      { type: 'aws', sso: { ...SSO, accountId: '12' } },
      'sso.accountId must be the 12 digits',
    ],
    [
      { type: 'aws', sso: { ...SSO, roleName: undefined } },
      'sso.roleName is required',
    ],
  ])('rejects %p', (entry, message) => {
    expect(() => awsLogin.parse(entry)).toThrow(message)
  })

  test('names the profile after the source and the login, or uses your own', () => {
    const place = {
      source: 'acme',
      name: 'acme-dev',
      identity: 'acme/acme-dev',
    }

    expect(awsProfile({ ...place, config: { sso: SSO } })).toBe(
      'local-env-acme-acme-dev',
    )
    expect(awsProfile({ ...place, config: { profile: 'mine' } })).toBe('mine')
    expect(
      awsLogin.loginCommand({ ...place, config: { profile: 'mine' } }),
    ).toBeNull()
  })

  test('shares one sso-session for each Identity Center', () => {
    expect(ssoSessionName(SSO)).toBe(
      ssoSessionName({ ...SSO, accountId: '210987654321' }),
    )
    expect(ssoSessionName(SSO)).not.toBe(
      ssoSessionName({ ...SSO, startUrl: 'https://other.awsapps.com/start' }),
    )
  })
})

describe('the vault login', () => {
  test('logs in with oidc by default, and gives its address to the CLI', () => {
    const config = vaultLogin.parse({
      type: 'vault',
      address: 'https://vault.acme.io/',
      role: 'dev',
    })
    const login = { source: 'acme', name: 'data', identity: '', config }

    expect(vaultLogin.loginCommand(login)).toEqual([
      'vault',
      'login',
      '-method=oidc',
      'role=dev',
    ])
    expect(vaultLogin.env(login)).toEqual({
      VAULT_ADDR: 'https://vault.acme.io',
    })
  })

  test.each([
    [{ type: 'vault' }, 'address is required'],
    [{ type: 'vault', address: 'vault.acme.io' }, 'address must be the URL'],
    [
      { type: 'vault', address: 'https://v.io', method: 'Bad One' },
      'method must be',
    ],
  ])('rejects %p', (entry, message) => {
    expect(() => vaultLogin.parse(entry)).toThrow(message)
  })
})
