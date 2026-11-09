import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { provisionedDockhand } from '#cli-tests/support/factories/dockhand.js'
import { buildManifest } from '#cli-tests/support/factories/manifest.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

const NO_TTY = { FAKE_PROMPTS_NO_TTY: '1' }

const AWS_DEV = {
  type: 'aws',
  region: 'eu-west-1',
  sso: {
    startUrl: 'https://acme.awsapps.com/start',
    region: 'eu-west-1',
    accountId: '123456789012',
    roleName: 'Dev',
  },
  help: 'Ask #platform for the dev account',
}
const PROFILE = 'local-env-acme-acme-dev'
const TITLE = 'acme-dev (AWS 123456789012 (Dev))'
const ARN = 'arn:aws:sts::123456789012:assumed-role/Dev/octocat'
const LOGGED_IN = { stdout: JSON.stringify({ Arn: ARN }) }
const NO_TOKEN = {
  exitCode: 255,
  stderr:
    'aws: [ERROR]: Error loading SSO Token: Token for acme does not exist',
}

const VAULT_DATA = {
  type: 'vault',
  address: 'https://vault.acme.test',
  namespace: 'dev',
  role: 'developer',
}

const createLoginsCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  machineReady(cli)
  cli.bin.on('which', ['ansible-playbook'])
  cli.bin.on('ansible-playbook', [])
  cli.bin.on('which', ['aws'])
  cli.bin.on('which', ['vault'])
  return cli
}

// A source whose manifest declares these logins, with a role for each list
// of names it needs (picked)
const addSource = async (
  cli: Cli,
  name: string,
  logins: Record<string, unknown>,
  roles: Record<string, string[]>,
) => {
  const repo = cli.createSource(name, { roles: Object.keys(roles) })
  repo.commit({
    'local-env.yml': buildManifest({ name, logins }),
    ...Object.fromEntries(
      Object.entries(roles).map(([role, names]) => [
        `ansible/${role}/local-env.yml`,
        `logins: [${names.join(', ')}]\n`,
      ]),
    ),
  })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
}

// The extra vars the playbook got
const extraVars = (cli: Cli) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const flag = run?.args.indexOf('--extra-vars') ?? -1
  const file = run?.args[flag + 1]?.replace(/^@/, '') ?? ''
  return JSON.parse(run?.inputs[file] ?? '{}') as Record<string, unknown>
}

const awsConfig = (cli: Cli) =>
  readFileSync(join(cli.root, 'user/.aws/config'), 'utf8')

describe.concurrent('local-env install, logins', () => {
  test('writes the AWS profile, checks the session and gives the role its environment', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(`${TITLE}: logged in as ${ARN}`)
    expect(cli.bin.calls('aws')[0]?.env.AWS_PROFILE).toBe(PROFILE)
    expect(awsConfig(cli)).toContain(
      [`[profile ${PROFILE}]`, 'sso_session = local-env-'].join('\n'),
    )
    expect(awsConfig(cli)).toContain(
      'sso_start_url = https://acme.awsapps.com/start',
    )
    expect(extraVars(cli).local_env_logins).toEqual({
      'acme-dev': {
        type: 'aws',
        profile: PROFILE,
        region: 'eu-west-1',
        env: { AWS_PROFILE: PROFILE, AWS_REGION: 'eu-west-1' },
      },
    })
  })

  test('gives the address of a Vault to its CLI and to the role', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('vault', ['token', 'lookup'], {
      env: { VAULT_ADDR: 'https://vault.acme.test', VAULT_NAMESPACE: 'dev' },
      stdout: JSON.stringify({ data: { display_name: 'oidc-octocat' } }),
    })
    await addSource(cli, 'acme', { data: VAULT_DATA }, { github: ['data'] })
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'data (Vault vault.acme.test (dev)): logged in as oidc-octocat',
    )
    expect(extraVars(cli).local_env_logins).toEqual({
      data: {
        type: 'vault',
        address: 'https://vault.acme.test',
        namespace: 'dev',
        env: {
          VAULT_ADDR: 'https://vault.acme.test',
          VAULT_NAMESPACE: 'dev',
        },
      },
    })
  })

  test('stops before Ansible when not logged in, without a terminal', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      `${TITLE}: not logged in, needed by Github. Nothing ran. In a terminal: local-env sources login acme --login acme-dev`,
    )
    expect(result.output).toContain('Ask #platform for the dev account')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('logs in to nothing from the dashboard', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    // A terminal, but the agent's: no question
    const result = await cli.run(['install'], {
      env: { LOCAL_ENV_FROM_DASHBOARD: '1' },
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'In a terminal: local-env sources login acme',
    )
    expect(cli.bin.calls('aws').map(({ args }) => args[0])).not.toContain('sso')
  })

  test.skipIf(COMPILED)('logs in when the user agrees, then runs', async () => {
    await using cli = await createLoginsCli()
    const session = join(cli.root, 'session')
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    cli.bin.on('aws', ['sts', 'get-caller-identity'], {
      ...LOGGED_IN,
      ifFile: session,
    })
    cli.bin.on('aws', ['sso', 'login'], { touch: session })
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'], {
      answers: [
        {
          ask: `${TITLE}: not logged in, needed by Github. Log in now?`,
          answer: true,
        },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(cli.bin.calls('aws')).toContainEqual(
      expect.objectContaining({ args: ['sso', 'login', '--profile', PROFILE] }),
    )
    expect(cli.bin.calls('ansible-playbook')).toHaveLength(1)
  })

  test('installs a missing CLI with Homebrew', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('which', ['aws'], { exitCode: 1 })
    cli.bin.on('brew', ['install', 'awscli'])
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(cli.bin.calls('brew')).toContainEqual(
      expect.objectContaining({ args: ['install', 'awscli'] }),
    )
    // The fake `which` still finds none
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('the aws CLI is still not installed')
  })

  test('names the logins that no source declares, and the registries', async () => {
    await using cli = await createLoginsCli()
    await addSource(
      cli,
      'acme',
      { ghcr: { type: 'registry', host: 'ghcr.io' } },
      { github: ['nope', 'ghcr'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Github needs the login nope, which no source declares.',
    )
    expect(result.output).toContain(
      'Github names ghcr, a registry login: a role can name aws and vault logins only.',
    )
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('refuses one name for the logins of two sources, and takes the source', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    await addSource(
      cli,
      'beta',
      { 'acme-dev': AWS_DEV },
      { deploy: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github', 'beta/deploy'])

    const clash = await cli.run(['install'], { env: NO_TTY })

    expect(clash.exitCode).toBe(1)
    expect(clash.output).toContain(
      'Github and Deploy both name the login acme-dev, but it is another login for each (in acme and in beta). Name its source in local-env.yml: beta/acme-dev.',
    )
  })

  test('keeps a profile of the same name that the user wrote', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    const own = `[profile ${PROFILE}]\nregion = us-east-1\n`
    mkdirSync(join(cli.root, 'user/.aws'), { recursive: true })
    writeFileSync(join(cli.root, 'user/.aws/config'), own)
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `has its own [profile ${PROFILE}]: local-env leaves it as it is.`,
    )
    expect(awsConfig(cli)).toContain(own)
    expect(awsConfig(cli).match(/\[profile /g)).toHaveLength(1)
  })
})

describe.concurrent('local-env sources remove, logins', () => {
  test('removes the AWS profiles that local-env wrote for the source', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      { github: ['acme-dev'] },
    )
    cli.home.seedPickedTools(['acme/github'])
    await cli.run(['install'])
    expect(awsConfig(cli)).toContain(`[profile ${PROFILE}]`)

    const result = await cli.run(['sources', 'remove', 'acme'])

    expect(result.exitCode).toBe(0)
    expect(awsConfig(cli)).not.toContain('[profile')
    expect(awsConfig(cli)).not.toContain('[sso-session')
  })
})

describe.concurrent('local-env sources login, aws and vault', () => {
  test('logs in to the login it names, with its CLI', async () => {
    await using cli = await createLoginsCli()
    const session = join(cli.root, 'session')
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    cli.bin.on('aws', ['sts', 'get-caller-identity'], {
      ...LOGGED_IN,
      ifFile: session,
    })
    cli.bin.on('aws', ['sso', 'login'], { touch: session })
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV }, {})

    const result = await cli.run([
      'sources',
      'login',
      'acme',
      '--login',
      'acme-dev',
    ])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(`${TITLE}: logged in as ${ARN}`)
    // Configured first: the profile must exist for `aws sso login`
    expect(awsConfig(cli)).toContain(`[profile ${PROFILE}]`)
  })

  test('needs your own terminal', async () => {
    await using cli = await createLoginsCli()
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV }, {})

    const result = await cli.run(
      ['sources', 'login', 'acme', '--login', 'acme-dev'],
      { env: NO_TTY },
    )

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(`Log in to ${TITLE} in your own terminal`)
    expect(cli.bin.calls('aws')).toEqual([])
  })
})

describe.concurrent('local-env sources logout, aws and vault', () => {
  test('logs out of a session', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    cli.bin.on('aws', ['sso', 'logout'])
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV }, {})

    const result = await cli.run(['sources', 'logout', 'acme'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(`Logged out of ${TITLE}`)
    expect(cli.bin.calls('aws')).toContainEqual(
      expect.objectContaining({
        args: ['sso', 'logout', '--profile', PROFILE],
      }),
    )
  })
})

// Snapshots can't run concurrently
describe('local-env sources list, aws and vault', () => {
  test('shows the state of each login, and what to run', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    cli.bin.on('vault', ['token', 'lookup'], {
      stdout: JSON.stringify({ data: { display_name: 'oidc-octocat' } }),
    })
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV, data: VAULT_DATA }, {})

    const result = await cli.run(['sources', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'acme-dev  AWS 123456789012 (Dev)  logged out: local-env sources login acme --login acme-dev',
    )
    expect(result.output).toContain(
      'data  Vault vault.acme.test (dev)  logged in as oidc-octocat',
    )
  })
})

describe.concurrent('local-env doctor, aws and vault', () => {
  test('warns about a login without a session', async () => {
    await using cli = await createLoginsCli()
    cli.home.seedCertificate()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV }, {})

    const result = await cli.run(['doctor'])

    expect(result.output).toContain(
      `${TITLE}: not logged in, needed by acme. Run \`local-env sources login acme --login acme-dev\`.`,
    )
  })
})
