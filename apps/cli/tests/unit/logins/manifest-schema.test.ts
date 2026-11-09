import { readFileSync } from 'fs'
import { join } from 'path'
import { LOGIN_TYPES } from '#cli/logins/index.js'
import { isValidLoginName } from '#cli/logins/declared.js'
import { isValidSourceName } from '#services/dashboard/source-manifest.js'

// schemas/source-manifest.json helps authors write local-env.yml in their
// editor. It must follow what the CLI accepts. Tests run from the root.
const schema = JSON.parse(
  readFileSync(join(process.cwd(), 'schemas/source-manifest.json'), 'utf8'),
)

describe('schemas/source-manifest.json', () => {
  test('has the same name rules as the CLI', () => {
    const names = new RegExp(schema.properties.name.pattern)
    const logins = new RegExp(schema.properties.logins.propertyNames.pattern)
    for (const name of ['acme', 'acme-2', '0day', '', '-a', 'Acme', 'a_b']) {
      expect(names.test(name)).toBe(isValidSourceName(name))
      expect(logins.test(name)).toBe(isValidLoginName(name))
    }
  })

  test('lists every type of login, each with its fields', () => {
    const types = LOGIN_TYPES.map(({ type }) => type)
    const { login } = schema.definitions

    expect(login.properties.type.enum).toEqual(types)
    expect(
      login.allOf.map(
        (branch: { if: { properties: { type: { const: string } } } }) =>
          branch.if.properties.type.const,
      ),
    ).toEqual(types)
    for (const type of types) {
      expect(schema.definitions[type]?.properties.type.const).toBe(type)
    }
  })
})
