import { act, screen, within } from '@testing-library/react'
import {
  buildRole,
  buildSource,
  buildTools,
} from '#ui-tests/support/factories.ts'
import { renderApp } from '#ui-tests/support/render-app.tsx'

describe('Sources on the overview', () => {
  test('lists the sources and what each offers', async () => {
    const { events } = await renderApp('/')

    act(() => events.emit('sources', [buildSource({ ansible: 8 })]))

    expect(
      screen.getByText('1 git repo of Docker templates and Ansible roles'),
    ).toBeInTheDocument()
    const source = screen.getByRole('listitem', { name: 'acme' })
    expect(
      within(source).getByText('3 templates · 8 roles'),
    ).toBeInTheDocument()
  })

  test('shows the label of the manifest, with the name under it', async () => {
    const { events } = await renderApp('/')

    act(() =>
      events.emit('sources', [
        buildSource({ name: 'acme-platform', label: 'Acme Platform' }),
      ]),
    )

    const source = screen.getByRole('listitem', { name: 'Acme Platform' })
    expect(
      within(source).getByText(
        'acme-platform · github.com/acme/local-env-templates',
      ),
    ).toBeInTheDocument()
  })

  test('shows the bootstrap of a source, with its roles and its state', async () => {
    const { events } = await renderApp('/')

    act(() => {
      events.emit('sources', [buildSource()])
      events.emit(
        'tools',
        buildTools({
          roles: [buildRole({ name: 'granted', label: 'Granted' })],
          bootstraps: [
            {
              source: 'acme',
              roles: ['acme/granted'],
              run: ['acme/granted'],
              state: 'changed',
              problems: [],
            },
          ],
        }),
      )
    })

    const source = screen.getByRole('listitem', { name: 'acme' })
    expect(within(source).getByText('Bootstrap')).toBeInTheDocument()
    expect(within(source).getByText('Granted')).toBeInTheDocument()
    expect(within(source).getByText('Changed')).toBeInTheDocument()
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
