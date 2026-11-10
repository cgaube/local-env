import { parseSecretRefs } from '#cli/logins/secrets.js'
import { pickSecretValue } from '#cli/logins/session.js'

describe('the secrets of a local-env.yml', () => {
  test('reads each secret, with its field when it has one', () => {
    expect(
      parseSecretRefs({
        STRIPE_KEY: { login: 'acme-dev', ref: 'billing/dev', field: 'stripe' },
        DB_PASSWORD: { login: 'platform/data', ref: 'secret/db' },
      }),
    ).toEqual({
      secrets: {
        STRIPE_KEY: { login: 'acme-dev', ref: 'billing/dev', field: 'stripe' },
        DB_PASSWORD: { login: 'platform/data', ref: 'secret/db' },
      },
      problems: [],
    })
  })

  test('gives a problem for each entry that is not valid, and keeps the others', () => {
    const { secrets, problems } = parseSecretRefs({
      GOOD: { login: 'acme-dev', ref: 'x' },
      'BAD-NAME': { login: 'acme-dev', ref: 'x' },
      lower: { login: 'acme-dev', ref: 'x' },
      LIST: ['acme-dev'],
      NO_REF: { login: 'acme-dev' },
      BAD_LOGIN: { login: 'Acme Dev', ref: 'x' },
      NUMBER: { login: 'acme-dev', ref: 3 },
    })

    expect(Object.keys(secrets)).toEqual(['GOOD'])
    expect(problems).toEqual([
      'secrets.BAD-NAME: a secret name is uppercase letters, digits and _, like an environment variable (STRIPE_KEY)',
      'secrets.lower: a secret name is uppercase letters, digits and _, like an environment variable (STRIPE_KEY)',
      'secrets.LIST must be a mapping with login and ref',
      'secrets.NO_REF.ref is required',
      'secrets.BAD_LOGIN.login must be the name of a login, or <source>/<login>',
      'secrets.NUMBER.ref must be text',
    ])
  })
})

describe('the value of a secret', () => {
  test('is the text as it is, or a field of its JSON', () => {
    expect(pickSecretValue('plain text', [])).toBe('plain text')
    expect(pickSecretValue('{"token":"t","n":{"a":1}}', ['token'])).toBe('t')
    expect(pickSecretValue('{"n":{"a":1}}', ['n'])).toBe('{"a":1}')
  })

  test('says why a field cannot be taken', () => {
    expect(() => pickSecretValue('not json', ['token'])).toThrow(
      'its value is not JSON: it has no fields',
    )
    expect(() => pickSecretValue('{"other":1}', ['token'])).toThrow(
      'it has no field token',
    )
  })
})
