import {
  iniHeaders,
  readIniSection,
  removeIniSections,
  writeIniSections,
} from '#cli/logins/ini.js'

const USER_FILE = `# my own profiles
[default]
region = eu-west-1

[profile mine]
region = us-east-1
`

describe('writeIniSections', () => {
  test('adds a section at the end, after a blank line', () => {
    const result = writeIniSections(USER_FILE, [
      { header: 'profile acme', values: { region: 'eu-west-1' } },
    ])

    expect(result).toBe(`${USER_FILE}\n[profile acme]\nregion = eu-west-1\n`)
  })

  test('replaces a section in place and keeps the others as they are', () => {
    const before = writeIniSections(USER_FILE, [
      { header: 'profile acme', values: { region: 'old', output: 'json' } },
    ]).replace('[profile mine]', '[profile acme-copy]\n\n[profile mine]')

    const result = writeIniSections(before, [
      { header: 'profile acme', values: { region: 'new' } },
    ])

    expect(readIniSection(result, 'profile acme')).toEqual({ region: 'new' })
    expect(readIniSection(result, 'profile mine')).toEqual({
      region: 'us-east-1',
    })
    expect(result.startsWith('# my own profiles\n[default]\n')).toBe(true)
  })

  test('writes an empty file', () => {
    expect(
      writeIniSections('', [{ header: 'profile a', values: { x: '1' } }]),
    ).toBe('[profile a]\nx = 1\n')
  })
})

describe('removeIniSections', () => {
  test('removes whole sections only', () => {
    const file = writeIniSections(USER_FILE, [
      { header: 'sso-session local-env-1', values: { sso_region: 'eu' } },
    ])

    const result = removeIniSections(file, ['sso-session local-env-1'])

    expect(iniHeaders(result)).toEqual(['default', 'profile mine'])
    expect(readIniSection(result, 'default')).toEqual({ region: 'eu-west-1' })
  })
})

describe('readIniSection', () => {
  test('is null for a section the file does not have', () => {
    expect(readIniSection(USER_FILE, 'profile acme')).toBeNull()
  })
})
