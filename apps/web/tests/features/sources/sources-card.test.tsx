import { act, screen, within } from '@testing-library/react'
import { buildSource } from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

describe('Sources on the overview', () => {
  test('lists the sources and what each offers', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('sources', [buildSource({ ansible: 8 })]))

    expect(
      screen.getByText('1 git repo of Docker templates and Ansible roles'),
    ).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /acme/ })
    expect(within(row).getByText('3 templates')).toBeInTheDocument()
    expect(within(row).getByText('8 roles')).toBeInTheDocument()
  })

  test('says how to add one', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('sources', []))

    expect(screen.getByText('local-env sources add <repo>')).toBeInTheDocument()
  })

  test('no longer has a page of its own', async () => {
    const { router } = await renderApp('/sources')

    expect(
      await screen.findByRole('heading', { name: 'Overview', level: 1 }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(
      screen.queryByRole('link', { name: 'Sources' }),
    ).not.toBeInTheDocument()
  })
})
