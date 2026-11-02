import { render, screen } from '@testing-library/react'
import { NavVersion } from '#ui/features/layout/nav-version'

describe('NavVersion', () => {
  test('links the release version to the changelog', () => {
    render(
      <NavVersion
        build={{ version: '0.2.0', kind: 'release', commit: 'abc1234' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'v0.2.0' })).toHaveAttribute(
      'href',
      expect.stringContaining('CHANGELOG.md'),
    )
    expect(screen.queryByText(/abc1234/)).not.toBeInTheDocument()
  })

  test('marks a build of a checkout, with its commit', () => {
    render(
      <NavVersion
        build={{ version: '0.2.0', kind: 'checkout', commit: 'abc1234-dirty' }}
      />,
    )

    expect(screen.getByText('Dev build')).toBeInTheDocument()
    expect(screen.getByText('v0.2.0 · abc1234-dirty')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('marks the dev server', () => {
    render(
      <NavVersion
        build={{ version: '0.2.0', kind: 'dev-server', commit: null }}
      />,
    )

    expect(screen.getByText('Dev server')).toBeInTheDocument()
    expect(screen.getByText('v0.2.0')).toBeInTheDocument()
  })
})
