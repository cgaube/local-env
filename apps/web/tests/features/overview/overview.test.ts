import { servicesSummary } from '#ui/features/overview/overview.ts'
import { buildService } from '#ui-tests/support/factories.ts'

describe('servicesSummary', () => {
  test('counts the running services', () => {
    expect(servicesSummary([buildService(), buildService()])).toBe('2 running')
  })

  test('names the services that are down', () => {
    const services = [
      buildService(),
      buildService({ service: 'catalog-server', state: 'exited' }),
    ]

    expect(servicesSummary(services)).toBe('1 of 2 not running: catalog-server')
  })
})
