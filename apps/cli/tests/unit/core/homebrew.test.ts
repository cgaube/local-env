import { isNewer, versionOfFormula } from '#cli/core/homebrew.js'

describe('isNewer', () => {
  test('compares each part as a number', () => {
    expect(isNewer('0.10.0', '0.9.1')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
  })
})

describe('versionOfFormula', () => {
  test("reads the formula's version line", () => {
    expect(
      versionOfFormula(
        [
          'class LocalEnv < Formula',
          '  url "https://github.com/cgaube/local-env/releases/download/v0.2.0/local-env"',
          '  version "0.2.0"',
          'end',
        ].join('\n'),
      ),
    ).toBe('0.2.0')
  })

  test('is null for anything else', () => {
    expect(versionOfFormula('<html>404: Not Found</html>')).toBeNull()
  })
})
