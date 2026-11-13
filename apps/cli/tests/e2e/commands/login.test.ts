import type { DockhandState } from '#cli-tests/support/fake-dockhand.js'
import {
  buildDockhandRegistry,
  provisionedDockhand,
} from '#cli-tests/support/factories/dockhand.js'
import { dockerRunning, machineReady } from '#cli-tests/support/machine.js'
import {
  loginNameFor,
  manifestFiles,
} from '#cli-tests/support/factories/manifest.js'
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
  registries: Record<string, unknown>[] = [GHCR],
  dockhand: Partial<DockhandState> = {},
) => {
  const cli = await createCli({
    dockhand: { ...provisionedDockhand(), ...dockhand },
  })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  const repo = cli.createSource('acme')
  repo.commit(manifestFiles('acme', registries))
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
      repo.commit(manifestFiles('acme', [GHCR]))

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
      'ghcr.io: acme needs a login to pull private images. Run `local-env login` to log in.',
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
      expect(cli.home.readJson('volumes/logins.json')).toMatchObject({
        ignored: ['registry:ghcr.io'],
      })

      await cli.run(['login', 'ghcr-io', '-u', 'octocat', '--password-stdin'], {
        stdin: TOKEN,
      })
      expect(cli.home.readJson('volumes/logins.json')).toMatchObject({
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
    expect(result.output).not.toContain('Dockhand set up for local-env')
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
      'ghcr.io rejected the login: Authentication failed — check username and password. Run `local-env login` to log in.',
    )
    expect(result.output).not.toContain(TOKEN)
    expect(cli.dockhand.state.registries).toEqual([])
  })
})

const QUAY = { host: 'quay.io' }
const ECR_HOST = '123456789012.dkr.ecr.us-east-1.amazonaws.com'

// Adds one more source that needs these registries
const addSource = async (
  cli: Cli,
  name: string,
  registries: Record<string, unknown>[],
) => {
  const repo = cli.createSource(name)
  repo.commit(manifestFiles(name, registries))
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
}

const stdinLogin = (...args: string[]) => [
  'login',
  ...args,
  '-u',
  'octocat',
  '--password-stdin',
]

describe.concurrent('local-env login', () => {
  test.skipIf(COMPILED)(
    'asks for the registry logins Dockhand lacks, then saves them',
    async () => {
      await using cli = await createCliWithSource()

      const result = await cli.run(['login'], { answers: logIn.slice(1) })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        '✔ acme/ghcr-io  ghcr.io  logged in as octocat',
      )
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
    'asks only for the logins that do not work, in every source',
    async () => {
      await using cli = await createCliWithSource([GHCR], {
        registries: [buildDockhandRegistry()],
      })
      await addSource(cli, 'beta', [QUAY])

      const result = await cli.run(['login'], {
        answers: [
          { ask: 'Username for quay.io', answer: 'robot' },
          { ask: 'Token for quay.io', answer: TOKEN },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        '✔ acme/ghcr-io  ghcr.io  logged in as octocat',
      )
      // No hint when the source gives none
      expect(result.questions).toEqual([
        'Username for quay.io',
        'Token for quay.io',
      ])
      expect(registryWrites(cli)).toEqual([
        expect.objectContaining({ method: 'POST', path: '/registries' }),
      ])
    },
  )

  test.skipIf(COMPILED)(
    'logs in again to a named login that works',
    async () => {
      await using cli = await createCliWithSource([GHCR, QUAY], {
        registries: [buildDockhandRegistry()],
      })

      const result = await cli.run(['login', 'acme/ghcr-io'], {
        answers: [
          {
            ask: 'Username for ghcr.io (your GitHub username)',
            answer: 'hubot',
          },
          {
            ask: 'Token for ghcr.io (a classic token with read:packages)',
            answer: TOKEN,
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(registryWrites(cli)).toEqual([
        expect.objectContaining({ method: 'PUT', path: '/registries/1' }),
      ])
    },
  )

  test.skipIf(COMPILED)(
    'asks only for the token of an ECR host: its username is AWS',
    async () => {
      await using cli = await createCliWithSource([{ host: ECR_HOST }])

      const result = await cli.run(['login'], {
        answers: [{ ask: `Token for ${ECR_HOST}`, answer: TOKEN }],
      })

      expect(result.exitCode).toBe(0)
      expect(cli.dockhand.state.registries).toEqual([
        expect.objectContaining({ url: ECR_HOST, username: 'AWS' }),
      ])
    },
  )

  test('needs no --username for an ECR host, with the token from stdin', async () => {
    await using cli = await createCliWithSource([{ host: ECR_HOST }])
    const name = `acme/${loginNameFor(ECR_HOST)}`

    const result = await cli.run(['login', name, '--password-stdin'], {
      stdin: TOKEN,
    })

    expect(result.exitCode).toBe(0)
    expect(cli.dockhand.state.registries).toEqual([
      expect.objectContaining({ url: ECR_HOST, username: 'AWS' }),
    ])
  })

  test('reads the token from stdin', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(stdinLogin('ghcr-io'), {
      stdin: `${TOKEN}\n`,
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      '✔ acme/ghcr-io  ghcr.io  logged in as octocat',
    )
    expect(cli.dockhand.state.registries).toEqual([
      expect.objectContaining({
        url: 'ghcr.io',
        username: 'octocat',
        password: TOKEN,
      }),
    ])
  })

  test('needs one named registry login with the token from stdin', async () => {
    await using cli = await createCliWithSource([GHCR, QUAY])

    const missing = await cli.run(stdinLogin(), { stdin: TOKEN })
    const given = await cli.run(stdinLogin('acme/quay-io'), { stdin: TOKEN })

    expect(missing.exitCode).toBe(1)
    expect(missing.output).toContain(
      '--username and --password-stdin are for one registry login that you type',
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

    const result = await cli.run(stdinLogin('ghcr-io-team-a'), {
      stdin: TOKEN,
    })

    expect(result.exitCode).toBe(0)
    expect(registryWrites(cli)).toEqual([
      expect.objectContaining({ method: 'POST', path: '/registries' }),
    ])
  })

  test('asks for <source>/<name> when sources share a login name', async () => {
    await using cli = await createCliWithSource()
    await addSource(cli, 'beta', [GHCR])

    const shared = await cli.run(stdinLogin('ghcr-io'), { stdin: TOKEN })
    const named = await cli.run(stdinLogin('beta/ghcr-io'), { stdin: TOKEN })

    expect(shared.exitCode).toBe(1)
    expect(shared.output).toContain(
      'Several sources have a login named "ghcr-io": acme/ghcr-io, beta/ghcr-io.',
    )
    expect(named.exitCode).toBe(0)
  })

  test('refuses a login no source declares', async () => {
    await using cli = await createCliWithSource()

    const unknown = await cli.run(stdinLogin('quay'), { stdin: TOKEN })
    const otherSource = await cli.run(stdinLogin('nope/ghcr-io'), {
      stdin: TOKEN,
    })

    for (const result of [unknown, otherSource]) {
      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('No source has a login named')
    }
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

    const result = await cli.run(stdinLogin('ghcr-io'), { stdin: TOKEN })

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

    const result = await cli.run(stdinLogin('ghcr-io'), { stdin: TOKEN })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'ghcr.io rejected the login: Authentication token rejected (HTTP 401)',
    )
    expect(result.output).not.toContain(TOKEN)
    expect(cli.dockhand.state.registries).toEqual([])
  })

  test('only says what to run without a terminal', async () => {
    await using cli = await createCliWithSource()

    const result = await cli.run(['login'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'acme/ghcr-io (ghcr.io): no login. Run `local-env login acme/ghcr-io` in a terminal, or give --username and --password-stdin.',
    )
  })

  test('says so when no source needs a login', async () => {
    await using cli = await createCliWithSource([])

    const result = await cli.run(['login'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No source needs a login')
  })
})

describe.concurrent('local-env logout', () => {
  test('removes the login of the host only, and names the sources that share it', async () => {
    const team = buildDockhandRegistry({ id: 2, url: 'ghcr.io/team' })
    await using cli = await createCliWithSource([GHCR], {
      registries: [buildDockhandRegistry(), team],
    })
    await addSource(cli, 'beta', [GHCR])

    const result = await cli.run(['logout', 'acme/ghcr-io'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Logged out of ghcr.io, also used by beta')
    expect(cli.dockhand.state.registries).toEqual([team])
  })

  test.skipIf(COMPILED)(
    'lists the logins, then logs out of the one picked',
    async () => {
      await using cli = await createCliWithSource([GHCR], {
        registries: [buildDockhandRegistry()],
      })
      await addSource(cli, 'beta', [QUAY])

      const result = await cli.run(['logout'], {
        answers: [
          {
            ask: 'Which login do you want to log out of?',
            answer: 'acme/ghcr-io',
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Logged out of ghcr.io')
      expect(cli.dockhand.state.registries).toEqual([])
    },
  )

  test('needs a name without a terminal', async () => {
    await using cli = await createCliWithSource([GHCR], {
      registries: [buildDockhandRegistry()],
    })

    const result = await cli.run(['logout'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Name the login to log out of: `local-env logout <source>/<name>`',
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
      '✗ ghcr.io: the registry rejects the login of octocat: Authentication token rejected (HTTP 401). Run `local-env login acme/ghcr-io`.',
    )
    expect(result.output).toContain(
      '▲ quay.io: no login, needed by acme. Run `local-env login acme/quay-io`.',
    )
    expect(cli.dockhand.requests).toContainEqual(
      expect.objectContaining({
        path: '/registries/test',
        body: { registryId: 1 },
      }),
    )
  })
})
