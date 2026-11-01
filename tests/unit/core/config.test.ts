import { rmSync, writeFileSync } from 'fs'
import {
  checkConfig,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  isValidDomain,
  normalizeDomain,
  readConfig,
  writeConfig,
} from '../../../src/core/config.js'

describe('normalizeDomain', () => {
  test.each([
    ['dev.test', 'dev.test'],
    ['.dev.test', 'dev.test'],
    ['..dev.test', 'dev.test'],
    [' Dev.Test ', 'dev.test'],
  ])('%p -> %p', (raw, expected) => {
    expect(normalizeDomain(raw)).toBe(expected)
  })
})

describe('isValidDomain', () => {
  test.each(['dev.test', 'acme-dev.test', 'a.b.c', 'localhost'])(
    'accepts %p',
    (domain) => {
      expect(isValidDomain(domain)).toBe(true)
    },
  )

  test.each([
    '',
    'dev..test',
    '-dev.test',
    'dev.test.',
    'dev test',
    'Dev.test',
  ])('rejects %p', (domain) => {
    expect(isValidDomain(domain)).toBe(false)
  })
})

describe('readConfig and writeConfig', () => {
  beforeEach(() => rmSync(CONFIG_PATH, { force: true }))

  test('reads the defaults without a config file', () => {
    expect(readConfig()).toEqual(DEFAULT_CONFIG)
  })

  test('fills in the settings the file leaves out', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ domain: 'acme.test' }))
    expect(readConfig()).toEqual({ ...DEFAULT_CONFIG, domain: 'acme.test' })
  })

  test('merges a patch into the stored settings', () => {
    writeConfig({ domain: 'acme.test' })
    writeConfig({ buildPort: 18000 })
    expect(readConfig()).toEqual({ domain: 'acme.test', buildPort: 18000 })
  })

  test('names the file when it is not valid JSON', () => {
    writeFileSync(CONFIG_PATH, '{ nope')
    expect(() => readConfig()).toThrow(`${CONFIG_PATH} is not valid JSON`)
  })

  test('rejects a domain that would name a path, and says how to fix it', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ domain: '../sudoers' }))
    expect(() => readConfig()).toThrow(
      'Fix it with `local-env config set domain <value>`',
    )
  })

  test('normalizes a hand-edited domain', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ domain: ' .Acme.Test ' }))
    expect(readConfig().domain).toBe('acme.test')
  })

  test('lists every invalid value in one error', () => {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ domain: '../sudoers', buildPort: 80 }),
    )
    expect(() => readConfig()).toThrow(
      /Invalid domain "..\/sudoers"[\s\S]*Invalid port "80"/,
    )
  })

  test('checkConfig returns the errors and the defaults', () => {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ domain: '../sudoers', buildPort: 18000 }),
    )
    const { config, errors } = checkConfig()
    expect(config).toEqual({ domain: DEFAULT_CONFIG.domain, buildPort: 18000 })
    expect(errors.map((error) => error.key)).toEqual(['domain'])
  })

  test('writes a patch while another value is invalid', () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ domain: '../sudoers' }))
    writeConfig({ domain: 'acme.test' })
    expect(readConfig().domain).toBe('acme.test')
  })
})
