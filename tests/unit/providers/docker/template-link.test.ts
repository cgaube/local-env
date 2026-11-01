import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { HOME_DIR } from '../../../../src/core/paths.js'
import {
  composeName,
  hashTemplate,
  isLinked,
  isValidTemplate,
  readLinks,
} from '../../../../src/providers/docker/template-link.js'
import { logger } from '../../../../src/utils/logger.js'
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

describe('isValidTemplate', () => {
  test.each(['acme/postgres', 'acme/my_app.v2'])('accepts %s', (template) => {
    expect(isValidTemplate(template)).toBe(true)
  })

  test.each(['../x', 'acme/..', 'acme/.hidden', 'acme', 'acme/a/b', '/etc'])(
    'rejects %s',
    (template) => {
      expect(isValidTemplate(template)).toBe(false)
    },
  )
})

describe('readLinks', () => {
  test('leaves out links whose template or base would name a path', () => {
    mkdirSync(join(HOME_DIR, 'volumes'), { recursive: true })
    writeFileSync(
      join(HOME_DIR, 'volumes/template-links.json'),
      JSON.stringify({
        mail: { template: 'acme/mail', base: 'abc123' },
        new: { template: 'acme/new', base: null },
        old: { ignored: true },
        escape: { template: '../../etc', base: 'abc123' },
        base: { template: 'acme/mail', base: '../../x' },
        broken: 'nope',
      }),
    )
    // Collected, not printed: the test run stays quiet
    const warnings: string[] = []
    const { warn } = logger
    logger.warn = (message) => {
      warnings.push(message)
    }
    try {
      expect(Object.keys(readLinks()).sort()).toEqual(['mail', 'new', 'old'])
    } finally {
      logger.warn = warn
    }
    expect(warnings.map((warning) => warning.split(':')[0])).toEqual([
      'escape',
      'base',
      'broken',
    ])
  })
})
