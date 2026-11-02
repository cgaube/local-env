import { filterRoutes, userRoutes } from '#ui/features/routes/routes.ts'
import { buildRoute } from '../../support/factories.ts'

describe('userRoutes', () => {
  test("leaves out local-env's own services", () => {
    const mail = buildRoute()
    const dockhand = buildRoute({ stack: 'local-env', container: 'dockhand' })

    expect(userRoutes([mail, dockhand])).toEqual([mail])
  })
})

describe('filterRoutes', () => {
  const mail = buildRoute({ hosts: ['mail.dev.test', 'smtp.dev.test'] })
  const api = buildRoute({
    hosts: ['api.dev.test'],
    url: 'https://api.dev.test',
    container: 'shop-api',
    stack: 'shop',
  })

  test.each([
    ['smtp', [mail]],
    ['SHOP-API', [api]],
    ['shop', [api]],
    ['  ', [mail, api]],
    ['nothing', []],
  ])('%p matches a host, the container or the stack', (query, expected) => {
    expect(filterRoutes([mail, api], query)).toEqual(expected)
  })
})
