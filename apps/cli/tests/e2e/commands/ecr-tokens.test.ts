import { join } from 'path'
import { provisionedDockhand } from '#cli-tests/support/factories/dockhand.js'
import { buildTemplate } from '#cli-tests/support/factories/template.js'
import { buildManifest } from '#cli-tests/support/factories/manifest.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

const NO_TTY = { FAKE_PROMPTS_NO_TTY: '1' }

const HOST = '123456789012.dkr.ecr.us-east-1.amazonaws.com'
const TOKEN = 'eyJwYXlsb2FkIjoiZWNyLXRva2VuIn0='
const ARN = 'arn:aws:sts::123456789012:assumed-role/Dev/octocat'

const LOGINS = {
  acme: { type: 'aws', profile: 'acme-dev' },
  ecr: { type: 'registry', host: HOST, login: 'acme' },
}

const GET_TOKEN = ['ecr', 'get-login-password', '--region', 'us-east-1']
const LOGGED_OUT = {
  exitCode: 255,
  stderr:
    'aws: [ERROR]: The SSO session associated with this profile has expired',
}

// A source with an ECR registry and its aws login, logged in unless the
// test says otherwise
const createEcrCli = async ({
  loggedIn = true,
  logins = LOGINS,
}: { loggedIn?: boolean; logins?: Record<string, unknown> } = {}) => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  cli.bin.on('which', ['aws'])
  cli.bin.on(
    'aws',
    ['sts', 'get-caller-identity'],
    loggedIn ? { stdout: JSON.stringify({ Arn: ARN }) } : LOGGED_OUT,
  )
  cli.bin.on('aws', GET_TOKEN, {
    env: { AWS_PROFILE: 'acme-dev' },
    stdout: `${TOKEN}\n`,
  })
  const repo = cli.createSource('acme')
  repo.commit({ 'local-env.yml': buildManifest({ name: 'acme', logins }) })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  return { cli, added }
}

const tokenCalls = (cli: Cli) =>
  cli.bin
    .calls('aws')
    .filter(
      ({ args }) => args.slice(0, 2).join(' ') === 'ecr get-login-password',
    )

const ecrRegistry = (cli: Cli) =>
  cli.dockhand.state.registries.find(({ url }) => url === HOST)

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString()

// A token saved `hours` ago, good for 12 hours from then
const seedTokenSavedAgo = (cli: Cli, hours: number) =>
  cli.home.writeJson('volumes/logins.json', {
    ignored: [],
    awsSections: [],
    registryTokens: {
      [HOST]: { savedAt: hoursAgo(hours), expiresAt: hoursAgo(hours - 12) },
    },
  })

describe.concurrent('local-env start, ECR tokens', () => {
  test('saves a token of the aws login in Dockhand, as the user AWS', async () => {
    const { cli, added } = await createEcrCli()
    await using _ = cli
    expect(added.exitCode).toBe(0)

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(ecrRegistry(cli)).toMatchObject({
      name: HOST,
      username: 'AWS',
      password: TOKEN,
    })
    expect(result.output + added.output).toContain(
      `${HOST}: new token from acme`,
    )
    expect(result.output + added.output).not.toContain(TOKEN)
    expect(tokenCalls(cli)[0]?.env.AWS_PROFILE).toBe('acme-dev')
    expect(cli.home.readJson('volumes/logins.json')).toMatchObject({
      registryTokens: { [HOST]: expect.any(Object) },
    })
    const { registryTokens } = cli.home.readJson('volumes/logins.json') as {
      registryTokens: Record<string, { savedAt: string; expiresAt: string }>
    }
    const { savedAt, expiresAt } = registryTokens[HOST]!
    expect(Date.parse(expiresAt) - Date.parse(savedAt)).toBe(12 * 3_600_000)
  })

  test('keeps a token with more than half of its life left', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    await cli.run(['start'], { env: NO_TTY })
    const before = tokenCalls(cli).length

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(tokenCalls(cli)).toHaveLength(before)
  })

  test('gets a new token once it has lived half of its 12 hours', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    await cli.run(['start'], { env: NO_TTY })
    seedTokenSavedAgo(cli, 7)
    const before = tokenCalls(cli).length

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(tokenCalls(cli)).toHaveLength(before + 1)
    expect(cli.dockhand.state.registries).toHaveLength(1)
  })

  test('only warns when the aws login is logged out, without a terminal', async () => {
    const { cli } = await createEcrCli({ loggedIn: false })
    await using _ = cli

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `${HOST}: no new token, the private images of acme may not pull. acme/acme (AWS profile acme-dev) is not logged in. Run \`local-env login acme/acme\`.`,
    )
    expect(tokenCalls(cli)).toEqual([])
    expect(ecrRegistry(cli)).toBeUndefined()
  })

  test.skipIf(COMPILED)(
    'asks nothing for the registry with a terminal',
    async () => {
      const { cli } = await createEcrCli()
      await using _ = cli

      // No answers: a question fails the test
      const result = await cli.run(['start'])

      expect(result.exitCode).toBe(0)
      expect(ecrRegistry(cli)?.username).toBe('AWS')
    },
  )
})

describe.concurrent('local-env login, ECR tokens', () => {
  test('keeps a fresh token without a name, and says when it expires', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    await cli.run(['start'], { env: NO_TTY })
    const before = tokenCalls(cli).length

    const result = await cli.run(['login'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `✔ acme/ecr  ${HOST}  token from acme/acme, expires in 11 h`,
    )
    expect(result.output).toContain('All logins work')
    expect(result.output).not.toContain('local-env update')
    expect(tokenCalls(cli)).toHaveLength(before)
  })

  test('gets a new token without a name once it has lived half of its life', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    await cli.run(['start'], { env: NO_TTY })
    seedTokenSavedAgo(cli, 7)
    const before = tokenCalls(cli).length

    const result = await cli.run(['login'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `✔ acme/ecr  ${HOST}  new token from acme/acme`,
    )
    expect(result.output).toContain(
      'New ECR token saved. `local-env update` pulls the latest images with it now.',
    )
    expect(tokenCalls(cli)).toHaveLength(before + 1)
  })

  test('gets a new token for a named login, even when it is fresh', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    await cli.run(['start'], { env: NO_TTY })
    const before = tokenCalls(cli).length

    const result = await cli.run(['login', 'acme/ecr'], {
      env: NO_TTY,
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `✔ acme/ecr  ${HOST}  new token from acme/acme`,
    )
    expect(tokenCalls(cli)).toHaveLength(before + 1)
  })

  test('fails when the aws login is logged out', async () => {
    const { cli } = await createEcrCli({ loggedIn: false })
    await using _ = cli

    const result = await cli.run(['login', 'acme/ecr'], {
      env: NO_TTY,
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'acme/acme (AWS profile acme-dev) is not logged in',
    )
  })
})

describe.concurrent('local-env start, a login of another source', () => {
  test('gets the token with an aws login of another source', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    const repo = cli.createSource('beta')
    const host = '123456789012.dkr.ecr.eu-west-1.amazonaws.com'
    cli.bin.on('aws', ['ecr', 'get-login-password', '--region', 'eu-west-1'], {
      env: { AWS_PROFILE: 'acme-dev' },
      stdout: `${TOKEN}\n`,
    })
    repo.commit({
      'local-env.yml': buildManifest({
        name: 'beta',
        logins: { ecr: { type: 'registry', host, login: 'acme/acme' } },
      }),
    })
    await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(cli.dockhand.state.registries).toContainEqual(
      expect.objectContaining({ url: host, username: 'AWS' }),
    )
  })

  test('warns when it names a login that gets no tokens', async () => {
    const { cli } = await createEcrCli()
    await using _ = cli
    const repo = cli.createSource('beta')
    repo.commit({
      'local-env.yml': buildManifest({
        name: 'beta',
        logins: {
          data: { type: 'vault', address: 'https://vault.acme.test' },
          ecr: {
            type: 'registry',
            host: '123456789012.dkr.ecr.eu-west-1.amazonaws.com',
            login: 'beta/data',
          },
        },
      }),
    })
    await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })

    const result = await cli.run(['start'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'names beta/data, a vault login, which gets no registry tokens.',
    )
  })
})

describe.concurrent('local-env sources add, ECR registries', () => {
  test.each([
    [
      'a host that is not ECR',
      { ...LOGINS, ecr: { type: 'registry', host: 'ghcr.io', login: 'acme' } },
      'logins.ecr.login: an aws login gets tokens for ECR registries only',
    ],
    [
      'a vault login',
      {
        acme: { type: 'vault', address: 'https://vault.acme.test' },
        ecr: LOGINS.ecr,
      },
      'logins.ecr.login names acme, a vault login, which gets no registry tokens',
    ],
    [
      'a token help',
      { ...LOGINS, ecr: { ...LOGINS.ecr, tokenHelp: 'from the console' } },
      'logins.ecr.login gets the token',
    ],
  ])('refuses login with %s', async (_what, logins, message) => {
    const { cli, added } = await createEcrCli({ logins })
    await using _ = cli

    expect(added.exitCode).toBe(1)
    expect(added.output).toContain(message)
  })
})

describe.concurrent('local-env install, ECR tokens', () => {
  test('gets a token after the playbook, which set up the aws login, before the stacks deploy', async () => {
    await using cli = await createCli({ dockhand: provisionedDockhand() })
    cli.home.seedConfig()
    cli.home.seedCertificate()
    machineReady(cli)
    // The profile acme-dev exists once a role of the install wrote it
    const profile = join(cli.root, 'aws-profile')
    cli.bin.on('which', ['aws'])
    cli.bin.on('which', ['ansible-playbook'])
    cli.bin.on('ansible-playbook', [], { touch: profile })
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_OUT)
    cli.bin.on('aws', ['sts', 'get-caller-identity'], {
      stdout: JSON.stringify({ Arn: ARN }),
      ifFile: profile,
    })
    cli.bin.on('aws', GET_TOKEN, {
      env: { AWS_PROFILE: 'acme-dev' },
      stdout: `${TOKEN}\n`,
    })
    const repo = cli.createSource('acme', {
      roles: ['aws_access', 'backend'],
      templates: [
        buildTemplate({
          folder: 'api',
          compose: `name: api\nservices:\n  api:\n    image: ${HOST}/api:latest\n`,
        }),
      ],
    })
    repo.commit({
      'local-env.yml': buildManifest({ name: 'acme', logins: LOGINS }),
      'ansible/backend/meta/main.yml':
        'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [aws_access]\n',
      'ansible/backend/local-env.yml': 'stacks: [api]\n',
    })
    await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })

    const result = await cli.run(['install', 'backend', '--yes'], {
      env: NO_TTY,
    })

    expect(result.exitCode).toBe(0)
    expect(ecrRegistry(cli)).toMatchObject({ username: 'AWS', password: TOKEN })
    expect(result.output).toContain('api deployed')
    // The token is saved before the stack is created
    const paths = cli.dockhand.requests
      .filter(({ method }) => method === 'POST')
      .map(({ path }) => path)
    expect(
      paths.findIndex((path) => path.startsWith('/registries')),
    ).toBeLessThan(paths.indexOf('/stacks'))
    expect(
      paths.findIndex((path) => path.startsWith('/registries')),
    ).toBeGreaterThan(-1)
    expect(tokenCalls(cli)).toHaveLength(1)
  })
})
