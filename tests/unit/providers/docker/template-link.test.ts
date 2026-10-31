import {
  composeName,
  hashTemplate,
  isLinked,
} from '../../../../src/providers/docker/template-link.js'
import { buildCompose } from '../../../support/factories/template.js'

describe('composeName', () => {
  test('reads the top-level name', () => {
    expect(composeName(buildCompose({ name: 'mail' }))).toBe('mail')
  })

  test('ignores a name taken from a variable', () => {
    expect(composeName('name: ${STACK_NAME}\nservices: {}\n')).toBeNull()
  })

  test('returns null without a name or for invalid YAML', () => {
    expect(composeName('services: {}\n')).toBeNull()
    expect(composeName('name: [')).toBeNull()
  })
})

describe('hashTemplate', () => {
  test('is short, stable and content based', () => {
    const compose = buildCompose()
    expect(hashTemplate(compose)).toMatch(/^[0-9a-f]{12}$/)
    expect(hashTemplate(compose)).toBe(hashTemplate(compose))
    expect(hashTemplate(compose)).not.toBe(hashTemplate(`${compose}\n`))
  })
})

describe('isLinked', () => {
  test('tells links from unlinked stacks', () => {
    expect(isLinked(undefined)).toBe(false)
    expect(isLinked({ ignored: true })).toBe(false)
  })
})
