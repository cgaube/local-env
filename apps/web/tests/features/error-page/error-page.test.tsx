import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '#ui-tests/support/render-app.tsx'

// The Tools page throws while `broken.page` is set
const broken = vi.hoisted(() => ({ page: false }))
vi.mock(
  '#ui/features/tools/catalog-page/catalog-page.tsx',
  async (original) => {
    const page = await original<{ CatalogPage: () => React.ReactNode }>()
    return {
      CatalogPage: () => {
        if (broken.page) throw new Error('roles is not iterable')
        return page.CatalogPage()
      },
    }
  },
)

const errorHeading = () => screen.getByRole('heading', { level: 1 })
const logo = () => document.querySelector('svg[data-variant]')

describe('Error page', () => {
  beforeEach(() => {
    broken.page = true
    // React logs the error it caught
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  test('shows a broken logo in place of the page, in the shell', async () => {
    await renderApp('/tools')

    const main = screen.getByRole('main')
    expect(within(main).getByText(/Something broke/)).toBeInTheDocument()
    expect(logo()).toBeInTheDocument()
    // The sidebar stays, so the other pages are a click away
    expect(screen.getByRole('link', { name: 'Docker' })).toBeInTheDocument()
  })

  test('shows the error on demand', async () => {
    const user = userEvent.setup()
    await renderApp('/tools')

    await user.click(screen.getByRole('button', { name: 'What broke' }))

    expect(screen.getByText('roles is not iterable')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Copy the error' }),
    ).toBeInTheDocument()
  })

  test('breaks the logo another way, with a title to match', async () => {
    const user = userEvent.setup()
    await renderApp('/tools')
    const first = logo()?.getAttribute('data-variant')
    const title = errorHeading().textContent

    await user.click(
      screen.getByRole('button', { name: 'Break it another way' }),
    )

    expect(logo()?.getAttribute('data-variant')).not.toBe(first)
    expect(errorHeading().textContent).not.toBe(title)
  })

  test('draws the page again once it works', async () => {
    const user = userEvent.setup()
    await renderApp('/tools')

    broken.page = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByRole('heading', { name: 'Tools', level: 1 }),
    ).toBeInTheDocument()
  })

  test('goes back to the overview', async () => {
    const user = userEvent.setup()
    await renderApp('/tools')

    await user.click(screen.getByRole('link', { name: 'Back to the overview' }))

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument()
  })
})
