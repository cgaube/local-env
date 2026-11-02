import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../support/render-app.tsx'

describe('Theme switcher', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })

  test.each([
    ['Dark', 'dark'],
    ['Light', 'light'],
  ])('switches to %s and remembers it', async (label, theme) => {
    const user = userEvent.setup()
    await renderApp('/')

    await user.click(screen.getByRole('button', { name: 'Theme' }))
    await user.click(await screen.findByRole('menuitemradio', { name: label }))

    expect(document.documentElement).toHaveClass(theme)
    expect(localStorage.getItem('theme')).toBe(theme)
  })
})
