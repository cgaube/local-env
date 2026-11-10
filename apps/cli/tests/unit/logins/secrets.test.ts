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
    const NAME_RULE =
      'a secret is named after the variable it fills: letters, digits and _, not first a digit, and not local_env… or ansible_…'
    const { secrets, problems } = parseSecretRefs({
      github_token: { login: 'acme-dev', ref: 'x' },
      DB_PASSWORD: { login: 'acme-dev', ref: 'x' },
      'bad-name': { login: 'acme-dev', ref: 'x' },
      local_env_x: { login: 'acme-dev', ref: 'x' },
      ansible_user: { login: 'acme-dev', ref: 'x' },
      list: ['acme-dev'],
      no_ref: { login: 'acme-dev' },
      bad_login: { login: 'Acme Dev', ref: 'x' },
      number: { login: 'acme-dev', ref: 3 },
    })

    expect(Object.keys(secrets)).toEqual(['github_token', 'DB_PASSWORD'])
    expect(problems).toEqual([
      `secrets.bad-name: ${NAME_RULE}`,
      `secrets.local_env_x: ${NAME_RULE}`,
      `secrets.ansible_user: ${NAME_RULE}`,
      'secrets.list must be a mapping with login and ref',
      'secrets.no_ref.ref is required',
      'secrets.bad_login.login must be the name of a login, or <source>/<login>',
      'secrets.number.ref must be text',
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
