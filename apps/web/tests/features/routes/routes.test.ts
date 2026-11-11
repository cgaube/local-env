import { userRoutes } from '#ui/features/routes/routes.ts'
import { buildRoute } from '#ui-tests/support/factories.ts'

describe('userRoutes', () => {
  test("leaves out local-env's own services", () => {
    const mail = buildRoute()
    const dockhand = buildRoute({ stack: 'local-env', container: 'dockhand' })

    expect(userRoutes([mail, dockhand])).toEqual([mail])
  })
})
