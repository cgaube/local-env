import { render, screen } from '@testing-library/react'
import { ExternalLink } from '#ui/features/links/external-link'

describe('ExternalLink', () => {
  test('opens in a new tab', () => {
    render(<ExternalLink href="https://mail.dev.test">Mailpit</ExternalLink>)

    const link = screen.getByRole('link', { name: 'Mailpit' })
    expect(link).toHaveAttribute('href', 'https://mail.dev.test')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
  })
})
