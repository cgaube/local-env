import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isValidSourceName,
  readSourceManifest,
  SourceManifestError,
  tryReadSourceManifest,
} from '#services/dashboard/source-manifest.js'

// A source folder with this local-env.yml, or none
const sourceWith = (manifest?: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'local-env-manifest-'))
  if (manifest !== undefined)
    writeFileSync(join(dir, 'local-env.yml'), manifest)
  return dir
}

describe('isValidSourceName', () => {
  test.each(['acme', 'acme-2', '0day'])('accepts %p', (name) => {
    expect(isValidSourceName(name)).toBe(true)
  })

  test.each(['', '-acme', 'Acme', 'acme_templates', 'acme.git'])(
    'rejects %p',
    (name) => {
      expect(isValidSourceName(name)).toBe(false)
    },
  )
})

describe('readSourceManifest', () => {
  test('is null without a manifest', () => {
    expect(readSourceManifest(sourceWith())).toBeNull()
  })

  test('reads the name, the label and the logins', () => {
    const dir = sourceWith(
      [
        'name: acme-platform',
        'label: "  Acme Platform "',
        'logins:',
        '  ghcr: { type: registry, host: ghcr.io }',
      ].join('\n'),
    )

    expect(readSourceManifest(dir)).toEqual({
      name: 'acme-platform',
      label: 'Acme Platform',
      logins: { ghcr: { type: 'registry', host: 'ghcr.io' } },
      secrets: {},
      bootstrap: [],
    })
  })

  test('needs only a name', () => {
    expect(readSourceManifest(sourceWith('name: acme'))).toEqual({
      name: 'acme',
      label: null,
      logins: {},
      secrets: {},
      bootstrap: [],
    })
  })

  test('reads the bootstrap roles, each once', () => {
    const dir = sourceWith(
      'name: acme\nbootstrap: [acme.platform.aws_access, vpn, vpn]',
    )

    expect(readSourceManifest(dir)?.bootstrap).toEqual([
      'acme.platform.aws_access',
      'vpn',
    ])
  })

  test.each([
    [
      'label: Acme',
      'name must be lowercase letters, digits and dashes (missing)',
    ],
    [
      'name: Acme',
      'name must be lowercase letters, digits and dashes ("Acme")',
    ],
    ['name: acme\nlabel: [a]', 'label must be text'],
    ['name: acme\nlogins: [ghcr]', 'logins must be a mapping of login names'],
    ['name: acme\nbootstrap: vpn', 'bootstrap must be a list of role names'],
    [
      'name: acme\nbootstrap: ["../vpn"]',
      'bootstrap must be a list of role names',
    ],
    ['- acme', 'must be a mapping with a name'],
    ['name: [', 'is not valid YAML'],
  ])('rejects %p', (manifest, message) => {
    const dir = sourceWith(manifest)

    expect(() => readSourceManifest(dir)).toThrow(SourceManifestError)
    expect(() => readSourceManifest(dir)).toThrow(message)
  })
})

describe('tryReadSourceManifest', () => {
  test('is null for a manifest that is not valid', () => {
    expect(tryReadSourceManifest(sourceWith('name: Acme'))).toBeNull()
  })
})
