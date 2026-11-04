import type { DockhandState } from '#cli-tests/support/fake-dockhand.js'
import {
  buildDockhandRegistry,
  provisionedDockhand,
} from '#cli-tests/support/factories/dockhand.js'
import { dockerRunning, machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

const TOKEN = 'ghp_secret_token_1234'
const NO_TTY = { FAKE_PROMPTS_NO_TTY: '1' }

const GHCR = {
  host: 'ghcr.io',
  usernameHelp: 'your GitHub username',
  tokenHelp: 'a classic token with read:packages',
}

// A provisioned Dockhand, and a source that needs these registries. Added
// without a terminal: the test asks the questions it wants afterwards.
const createCliWithSource = async (
  registries: unknown[] = [GHCR],
  dockhand: Partial<DockhandState> = {},
) => {
  const cli = await createCli({
    dockhand: { ...provisionedDockhand(), ...dockhand },
  })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  const repo = cli.createSource('acme')
  repo.commit({
    'docker/registries.json': `${JSON.stringify(registries, null, 2)}\n`,
  })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
  return cli
}

const registryWrites = (cli: Cli) =>
  cli.dockhand.requests.filter(
    (request) =>
      request.path.startsWith('/registries') &&
      request.path !== '/registries/test' &&
      request.method !== 'GET',
  )

const logIn = [
  { ask: 'ghcr.io: acme needs a login', answer: 'login' },
  { ask: 'Username for ghcr.io (your GitHub username)', answer: 'octocat' },
  {
    ask: 'Token for ghcr.io (a classic token with read:packages)',
    answer: TOKEN,
  },
]

describe.concurrent('local-env sources add, registry logins', () => {
  test.skipIf(COMPILED)(
    'asks for the login of a registry the source needs',
    async () => {
      await using cli = await createCli({ dockhand: provisionedDockhand() })
      cli.home.seedConfig()
      dockerRunning(cli.bin)
      const repo = cli.createSource('acme')
      repo.commit({ 'docker/registries.json': JSON.stringify([GHCR]) })

      const result = await cli.run(['sources', 'add', repo.dir], {
        answers: logIn,
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Logged in to ghcr.io as octocat')
      expect(result.output).not.toContain(TOKEN)
      expect(cli.dockhand.state.registries).toEqual([
        {
          id: 1,
          name: 'ghcr.io',
          url: 'ghcr.io',
          username: 'octocat',
          password: TOKEN,
          isDefault: false,
        },
      ])
    },
  )

  test('only says how to log in without a terminal', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'ghcr.io: acme needs a login to pull private images. Run `local-env sources login acme` to log in.',
    )
    expect(cli.dockhand.state.registries).toEqual([])
  })
})

describe.concurrent('local-env start, registry logins', () => {
  test.skipIf(COMPILED)('asks again after "Not now"', async () => {
    await using cli = await createCliWithSource()

    const later = await cli.run(['start'], {
      answers: [{ ask: 'ghcr.io: acme needs a login', answer: 'later' }],
    })
    const again = await cli.run(['start'], { answers: logIn })

    expect(later.exitCode).toBe(0)
    expect(again.exitCode).toBe(0)
    expect(cli.dockhand.state.registries).toHaveLength(1)
  })

  test.skipIf(COMPILED)(
    'stops asking after "Don\'t ask again", until a login',
    async () => {
      await using cli = await createCliWithSource()

      await cli.run(['start'], {
        answers: [{ ask: 'ghcr.io: acme needs a login', answer: 'never' }],
      })
      // No answers: a question fails the test
      const quiet = await cli.run(['start'])

      expect(quiet.exitCode).toBe(0)
      expect(cli.home.readJson('volumes/registries.json')).toEqual({
        ignored: ['ghcr.io'],
      })

      await cli.run(
        ['sources', 'login', 'acme', '-u', 'octocat', '--password-stdin'],
        { stdin: TOKEN },
      )
      expect(cli.home.readJson('volumes/registries.json')).toEqual({
        ignored: [],
      })
    },
  )

  test('changes nothing when the registry has a login', async () => {
    await using cli = await createCliWithSource([GHCR], {
      registries: [buildDockhandRegistry()],
    })

    const result = await cli.run(['start'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Configuration up to date')
    expect(registryWrites(cli)).toEqual([])
  })

  test.skipIf(COMPILED)('saves nothing the registry rejects', async () => {
    await using cli = await createCliWithSource()
    cli.dockhand.on('POST /registries/test', () => ({
      success: false,
      connectivity: true,
      authenticated: false,
      message: 'Authentication failed — check username and password',
    }))

    const result = await cli.run(['start'], { answers: logIn })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'ghcr.io rejected the login: Authentication failed — check username and password. Run `local-env sources login acme` to log in.',
    )
    expect(result.output).not.toContain(TOKEN)
    expect(cli.dockhand.state.registries).toEqual([])
  })
})

const QUAY = { host: 'quay.io' }

// Adds one more source that needs these registries
const addSource = async (cli: Cli, name: string, registries: unknown[]) => {
  const repo = cli.createSource(name)
  repo.commit({ 'docker/registries.json': JSON.stringify(registries) })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
}

const stdinLogin = (...args: string[]) => [
  'sources',
  'login',
  ...args,
  '-u',
  'octocat',
  '--password-stdin',
]

describe.concurrent('local-env sources login', () => {
  test.skipIf(COMPILED)(
    'asks for the username and the token, then saves them',
    async () => {
      await using cli = await createCliWithSource()

      const result = await cli.run(['sources', 'login', 'acme'], {
        answers: logIn.slice(1),
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Logged in to ghcr.io as octocat')
      expect(result.output).not.toContain(TOKEN)
      expect(cli.dockhand.requests).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/registries/test',
          body: { url: 'ghcr.io', username: 'octocat', password: TOKEN },
        }),
      )
      expect(cli.dockhand.state.registries).toEqual([
        expect.objectContaining({ url: 'ghcr.io', password: TOKEN }),
      ])
    },
  )

  test.skipIf(COMPILED)(
    'lists the sources that need a login, then logs in to the one picked',
    async () => {
      await using cli = await createCliWithSource()
      await addSource(cli, 'beta', [QUAY])

      const result = await cli.run(['sources', 'login'], {
        answers: [
          { ask: 'Which source do you want to log in to?', answer: 'beta' },
          { ask: 'Username for quay.io', answer: 'robot' },
          { ask: 'Token for quay.io', answer: TOKEN },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('acme  ghcr.io no login')
      expect(result.output).toContain('beta  quay.io no login')
      // No hint when the source gives none
      expect(result.questions).toEqual([
        'Which source do you want to log in to?',
        'Username for quay.io',
        'Token for quay.io',
      ])
      expect(cli.dockhand.state.registries).toEqual([
        expect.objectContaining({ url: 'quay.io', username: 'robot' }),
      ])
    },
  )

  test.skipIf(COMPILED)(
    'asks before logging in again to a registry with a login',
    async () => {
      await using cli = await createCliWithSource([GHCR, QUAY], {
        registries: [buildDockhandRegistry()],
      })

      const result = await cli.run(['sources', 'login', 'acme'], {
        answers: [
          {
            ask: 'ghcr.io: logged in as octocat. Log in again?',
            answer: false,
          },
          { ask: 'Username for quay.io', answer: 'robot' },
          { ask: 'Token for quay.io', answer: TOKEN },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(registryWrites(cli)).toEqual([
        expect.objectContaining({ method: 'POST', path: '/registries' }),
      ])
    },
  )

  test('reads the token from stdin', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(stdinLogin('acme'), { stdin: `${TOKEN}\n` })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Logged in to ghcr.io as octocat')
    expect(cli.dockhand.state.registries).toEqual([
      expect.objectContaining({
        url: 'ghcr.io',
        username: 'octocat',
        password: TOKEN,
      }),
    ])
  })

  test('needs --registry with the token from stdin, for several registries', async () => {
    await using cli = await createCliWithSource([GHCR, QUAY])

    const missing = await cli.run(stdinLogin('acme'), { stdin: TOKEN })
    const given = await cli.run(
      stdinLogin('acme', '--registry', 'https://Quay.io/'),
      { stdin: TOKEN },
    )

    expect(missing.exitCode).toBe(1)
    expect(missing.output).toContain(
      'acme needs several registries (ghcr.io, quay.io): give --registry.',
    )
    expect(given.exitCode).toBe(0)
    expect(cli.dockhand.state.registries).toEqual([
      expect.objectContaining({ url: 'quay.io' }),
    ])
  })

  test('counts the registries of one host once', async () => {
    await using cli = await createCliWithSource([
      { host: 'ghcr.io/team-a' },
      { ...GHCR, host: 'https://GHCR.io/team-b' },
    ])

    const result = await cli.run(stdinLogin('acme'), { stdin: TOKEN })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Logged in to ghcr.io as octocat')
    expect(registryWrites(cli)).toEqual([
      expect.objectContaining({ method: 'POST', path: '/registries' }),
    ])
  })

  test('refuses a registry the source does not list', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(stdinLogin('acme', '--registry', 'quay.io'), {
      stdin: TOKEN,
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'acme needs no login for quay.io, only for ghcr.io.',
    )
  })

  test('refuses an unknown source', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(stdinLogin('nope'), { stdin: TOKEN })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No source named "nope"')
  })

  test('updates the login of the host and leaves the others alone', async () => {
    const others = [
      buildDockhandRegistry({ id: 2, name: 'Quay', url: 'quay.io' }),
      buildDockhandRegistry({
        id: 3,
        name: 'Team',
        url: 'https://ghcr.io/team',
        password: 'ghp_team',
      }),
    ]
    await using cli = await createCliWithSource([GHCR], {
      registries: [
        buildDockhandRegistry({ name: 'GHCR', url: 'https://ghcr.io' }),
        ...others,
      ],
    })

    const result = await cli.run(stdinLogin('acme'), { stdin: TOKEN })

    expect(result.exitCode).toBe(0)
    expect(registryWrites(cli)).toEqual([
      expect.objectContaining({ method: 'PUT', path: '/registries/1' }),
    ])
    expect(cli.dockhand.state.registries).toEqual([
      buildDockhandRegistry({
        name: 'GHCR',
        url: 'https://ghcr.io',
        password: TOKEN,
      }),
      ...others,
    ])
  })

  test('fails on a login the registry rejects', async () => {
    await using cli = await createCliWithSource()
    cli.dockhand.on('POST /registries/test', () => ({
      success: false,
      connectivity: true,
      authenticated: false,
      message: 'Authentication token rejected (HTTP 401)',
    }))

    const result = await cli.run(stdinLogin('acme'), { stdin: TOKEN })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'ghcr.io rejected the login: Authentication token rejected (HTTP 401)',
    )
    expect(result.output).not.toContain(TOKEN)
    expect(cli.dockhand.state.registries).toEqual([])
  })

  test('needs --username and --password-stdin without a terminal', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(['sources', 'login', 'acme'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Give --username and --password-stdin to log in without a terminal.',
    )
  })
})

// Snapshots can't run concurrently
describe('local-env sources login, without a name', () => {
  test('lists the sources that need a login, and their login', async () => {
    await using cli = await createCliWithSource([GHCR, QUAY], {
      registries: [buildDockhandRegistry()],
    })
    await addSource(cli, 'beta', [QUAY])
    await addSource(cli, 'plain', [])

    const result = await cli.run(['sources', 'login'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })
})

describe.concurrent('local-env sources logout', () => {
  test('removes the login of the host only, and names the sources that share it', async () => {
    const team = buildDockhandRegistry({ id: 2, url: 'ghcr.io/team' })
    await using cli = await createCliWithSource([GHCR], {
      registries: [buildDockhandRegistry(), team],
    })
    await addSource(cli, 'beta', [GHCR])

    const result = await cli.run(['sources', 'logout', 'acme'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Logged out of ghcr.io, also used by beta')
    expect(cli.dockhand.state.registries).toEqual([team])
  })

  test.skipIf(COMPILED)(
    'lists the sources with a login, then logs out of the one picked',
    async () => {
      await using cli = await createCliWithSource([GHCR], {
        registries: [buildDockhandRegistry()],
      })
      await addSource(cli, 'beta', [QUAY])

      const result = await cli.run(['sources', 'logout'], {
        answers: [
          { ask: 'Which source do you want to log out of?', answer: 'acme' },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Logged out of ghcr.io')
      expect(cli.dockhand.state.registries).toEqual([])
    },
  )

  test('logs out of a host the source lists twice once', async () => {
    await using cli = await createCliWithSource(
      [{ host: 'ghcr.io/team-a' }, { host: 'ghcr.io/team-b' }],
      { registries: [buildDockhandRegistry()] },
    )

    const result = await cli.run(['sources', 'logout', 'acme'])

    expect(result.exitCode).toBe(0)
    expect(registryWrites(cli)).toEqual([
      expect.objectContaining({ method: 'DELETE' }),
    ])
    expect(cli.dockhand.state.registries).toEqual([])
  })

  test('needs a name without a terminal', async () => {
    await using cli = await createCliWithSource([GHCR], {
      registries: [buildDockhandRegistry()],
    })

    const result = await cli.run(['sources', 'logout'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Name the source to log out of: `local-env sources logout <name>`',
    )
    expect(cli.dockhand.state.registries).toHaveLength(1)
  })
})

describe.concurrent('local-env doctor, registry logins', () => {
  test('warns about a missing login, fails on a rejected one', async () => {
    await using cli = await createCliWithSource([GHCR, { host: 'quay.io' }], {
      registries: [buildDockhandRegistry()],
    })
    cli.dockhand.on('POST /registries/test', () => ({
      success: false,
      connectivity: true,
      authenticated: false,
      message: 'Authentication token rejected (HTTP 401)',
    }))

    const result = await cli.run(['doctor'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      '✗ ghcr.io: the registry rejects the login of octocat: Authentication token rejected (HTTP 401). Run `local-env sources login acme`.',
    )
    expect(result.output).toContain(
      '▲ quay.io: no login, needed by acme. Run `local-env sources login acme`.',
    )
    expect(cli.dockhand.requests).toContainEqual(
      expect.objectContaining({
        path: '/registries/test',
        body: { registryId: 1 },
      }),
    )
  })
})
