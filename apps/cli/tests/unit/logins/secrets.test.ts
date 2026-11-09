import { parseSecretRefs } from '#cli/logins/secrets.js'

describe('the secrets of a local-env.yml', () => {
  test('reads each secret, with its field when it has one', () => {
    expect(
      parseSecretRefs({
        stripe_key: { login: 'acme-dev', ref: 'billing/dev', field: 'stripe' },
        DB_PASSWORD: { login: 'platform/data', ref: 'secret/db' },
      }),
    ).toEqual({
      secrets: {
        stripe_key: { login: 'acme-dev', ref: 'billing/dev', field: 'stripe' },
        DB_PASSWORD: { login: 'platform/data', ref: 'secret/db' },
      },
      problems: [],
    })
  })

  test('gives a problem for each entry that is not valid, and keeps the others', () => {
    const { secrets, problems } = parseSecretRefs({
      good: { login: 'acme-dev', ref: 'x' },
      'bad-name': { login: 'acme-dev', ref: 'x' },
      list: ['acme-dev'],
      no_ref: { login: 'acme-dev' },
      bad_login: { login: 'Acme Dev', ref: 'x' },
      number: { login: 'acme-dev', ref: 3 },
    })

    expect(Object.keys(secrets)).toEqual(['good'])
    expect(problems).toEqual([
      'secrets.bad-name: a secret name is letters, digits and _, not first a digit',
      'secrets.list must be a mapping with login and ref',
      'secrets.no_ref.ref is required',
      'secrets.bad_login.login must be the name of a login, or <source>/<login>',
      'secrets.number.ref must be text',
    ])
  })
})
