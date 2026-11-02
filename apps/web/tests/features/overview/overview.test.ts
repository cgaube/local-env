import { appContent, servicesSummary } from '#ui/features/overview/overview.ts'
import { buildService, buildSource } from '../../support/factories.ts'

describe('appContent', () => {
  test('counts what the app installs from the sources', () => {
    const sources = [
      buildSource({ docker: 2 }),
      buildSource({ name: 'team', docker: 1 }),
      buildSource({ name: 'roles-only', docker: 0, ansible: 4 }),
    ]

    expect(appContent('docker', sources)).toBe('3 templates from 2 sources')
    expect(appContent('ansible', sources)).toBe('4 roles from 1 source')
  })

  test('says when the sources have nothing for it', () => {
    expect(appContent('ansible', [buildSource()])).toBe(
      'No roles in the sources yet',
    )
  })

  test('says nothing for an app without content', () => {
    expect(appContent(null, [buildSource()])).toBeNull()
    expect(appContent('helm', [buildSource()])).toBeNull()
  })
})

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
