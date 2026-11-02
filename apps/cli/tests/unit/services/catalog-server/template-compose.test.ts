import {
  contextPath,
  findBuildContexts,
  prepareTemplateCompose,
  replaceHostHome,
  rewriteBuildContexts,
} from '#services/catalog-server/template-compose.js'

const options = { source: 'acme', folder: 'hello', buildPort: 17080 }
const contextUrl = (path: string) =>
  `http://host.docker.internal:17080/acme.git#main:${path}`

describe('findBuildContexts', () => {
  test('lists relative contexts once, in both build forms', () => {
    const compose = [
      'services:',
      '  web:',
      '    build: ./site',
      '  worker:',
      '    build:',
      '      context: ./site',
      '  api:',
      '    build:',
      '      context: ../api',
    ].join('\n')

    expect(findBuildContexts(compose)).toEqual(['./site', '../api'])
  })

  test('ignores absolute paths, URLs and images', () => {
    const compose = [
      'services:',
      '  a:',
      '    build: /srv/app',
      '  b:',
      '    build: https://github.com/acme/app.git',
      '  c:',
      '    image: nginx',
    ].join('\n')

    expect(findBuildContexts(compose)).toEqual([])
  })

  test('returns nothing for invalid YAML', () => {
    expect(findBuildContexts('services: [')).toEqual([])
  })
})

describe('contextPath', () => {
  test('resolves the context inside docker/<folder>', () => {
    expect(contextPath('hello', './site')).toBe('docker/hello/site')
    expect(contextPath('hello', '../shared')).toBe('docker/shared')
  })

  test('refuses a context outside the repo', () => {
    expect(contextPath('hello', '../../../etc')).toBeNull()
  })
})

describe('rewriteBuildContexts', () => {
  test('rewrites only the value and keeps comments and quotes', () => {
    const compose = [
      'services:',
      '  web:',
      "    build: './site' # the website",
      '  api:',
      '    build:',
      '      context: ./api',
    ].join('\n')

    expect(rewriteBuildContexts(compose, options)).toBe(
      [
        'services:',
        '  web:',
        `    build: ${contextUrl('docker/hello/site')} # the website`,
        '  api:',
        '    build:',
        `      context: ${contextUrl('docker/hello/api')}`,
      ].join('\n'),
    )
  })

  test('leaves a compose file without build contexts unchanged', () => {
    const compose = 'services:\n  web:\n    image: nginx\n'
    expect(rewriteBuildContexts(compose, options)).toBe(compose)
  })
})

describe('replaceHostHome', () => {
  test.each([
    ['${HOST_HOME}/app.ini', '/Users/me/app.ini'],
    ['$HOST_HOME/app.ini', '/Users/me/app.ini'],
    ['${HOST_HOME:-/tmp}/app.ini', '/Users/me/app.ini'],
    ['$HOST_HOMES', '$HOST_HOMES'],
  ])('%p -> %p', (compose, expected) => {
    expect(replaceHostHome(compose, '/Users/me')).toBe(expected)
  })

  test('keeps the variable when the home folder is unknown', () => {
    expect(replaceHostHome('${HOST_HOME}/app.ini', '')).toBe(
      '${HOST_HOME}/app.ini',
    )
  })
})

test('prepareTemplateCompose applies both rewrites', () => {
  const compose = [
    'services:',
    '  web:',
    '    build: ./site',
    '    volumes:',
    '      - ${HOST_HOME}/dev:/dev',
  ].join('\n')

  expect(
    prepareTemplateCompose(compose, { ...options, hostHome: '/Users/me' }),
  ).toBe(
    [
      'services:',
      '  web:',
      `    build: ${contextUrl('docker/hello/site')}`,
      '    volumes:',
      '      - /Users/me/dev:/dev',
    ].join('\n'),
  )
})
