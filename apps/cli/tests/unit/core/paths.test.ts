import { resolveInside } from '#cli/core/paths.js'

describe('resolveInside', () => {
  test('resolves paths inside the base', () => {
    expect(resolveInside('/base', 'acme', 'docker/web')).toBe(
      '/base/acme/docker/web',
    )
  })

  test('refuses paths that leave the base', () => {
    expect(() => resolveInside('/base', '../etc')).toThrow()
    expect(() => resolveInside('/base', 'acme/../../etc')).toThrow()
    expect(() => resolveInside('/base', '/etc/passwd')).toThrow()
    expect(() => resolveInside('/base', '../base-other')).toThrow()
  })

  test('refuses the base itself', () => {
    expect(() => resolveInside('/base', '')).toThrow()
    expect(() => resolveInside('/base', 'acme/..')).toThrow()
  })
})
