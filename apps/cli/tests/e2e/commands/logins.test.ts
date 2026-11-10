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
// of names it needs, or for each local-env.yml as written
const addSource = async (
  cli: Cli,
  name: string,
  logins: Record<string, unknown>,
  roles: Record<string, string[] | string>,
) => {
  const repo = cli.createSource(name, { roles: Object.keys(roles) })
  repo.commit({
    'local-env.yml': buildManifest({ name, logins }),
    ...Object.fromEntries(
      Object.entries(roles).map(([role, names]) => [
        `ansible/${role}/local-env.yml`,
        typeof names === 'string' ? names : `logins: [${names.join(', ')}]\n`,
      ]),
    ),
  })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
}

// The extra vars the playbook got in its file (extra-vars.json)
const extraVars = (cli: Cli) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const file = run?.args.find((arg) => arg.endsWith('extra-vars.json')) ?? ''
  return JSON.parse(run?.inputs[file.replace(/^@/, '')] ?? '{}') as Record<
    string,
    unknown
  >
}

// What Ansible read from the pipe of the secrets, as written
const secretsInput = (cli: Cli) => {
  const run = cli.bin.calls('ansible-playbook').at(-1)
  const file = run?.args.find((arg) => arg.endsWith('secrets.yml')) ?? ''
  return run?.inputs[file.replace(/^@/, '')]
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

  test('reads the secrets of the roles, and gives them to Ansible through a pipe', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    cli.bin.on(
      'aws',
      ['secretsmanager', 'get-secret-value', '--secret-id', 'billing/dev'],
      {
        env: { AWS_PROFILE: PROFILE },
        stdout: `${JSON.stringify({ stripe_key: 'sk_{{ "x" }}', other: 'no' })}\n`,
      },
    )
    cli.bin.on('vault', ['token', 'lookup'], {
      stdout: JSON.stringify({ data: { display_name: 'oidc-octocat' } }),
    })
    cli.bin.on('vault', ['kv', 'get', '-field=password', 'secret/billing'], {
      env: { VAULT_ADDR: 'https://vault.acme.test', VAULT_NAMESPACE: 'dev' },
      stdout: 'pa ss\n',
    })
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV, data: VAULT_DATA },
      {
        billing: [
          'secrets:',
          '  STRIPE_KEY: { login: acme-dev, ref: billing/dev, field: stripe_key }',
          '  DB_PASSWORD: { login: data, ref: secret/billing, field: password }',
          '',
        ].join('\n'),
        // The same secret again: read once
        payments: [
          'secrets:',
          '  STRIPE_KEY: { login: acme-dev, ref: billing/dev, field: stripe_key }',
          '',
        ].join('\n'),
      },
    )
    cli.home.seedPickedTools(['acme/billing', 'acme/payments'])

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Read 2 secrets of the tools: STRIPE_KEY, DB_PASSWORD',
    )
    expect(
      cli.bin.calls('aws').filter(({ args }) => args[0] === 'secretsmanager'),
    ).toHaveLength(1)
    // In no file of the run folder, which is on the disk
    expect(extraVars(cli)).toEqual({})
    const files = cli.bin.calls('ansible-playbook').at(-1)?.runFolder ?? {}
    expect(Object.keys(files).length).toBeGreaterThan(0)
    for (const content of Object.values(files)) {
      expect(content).not.toContain('pa ss')
      expect(content).not.toContain('sk_')
    }
    // As text, never templated by Ansible
    expect(secretsInput(cli)).toBe(
      [
        'local_env_secrets:',
        '  STRIPE_KEY: !unsafe "sk_{{ \\"x\\" }}"',
        '  DB_PASSWORD: !unsafe "pa ss"',
        '',
      ].join('\n'),
    )
  })

  test('stops before Ansible when a secret cannot be read', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    cli.bin.on('aws', ['secretsmanager', 'get-secret-value'], {
      exitCode: 254,
      stderr:
        'An error occurred (AccessDeniedException) when calling the GetSecretValue operation: not authorized',
    })
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      {
        billing:
          'secrets:\n  STRIPE_KEY: { login: acme-dev, ref: billing/dev, field: stripe_key }\n',
      },
    )
    cli.home.seedPickedTools(['acme/billing'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Billing: the secret STRIPE_KEY (billing/dev stripe_key, acme-dev) could not be read: An error occurred (AccessDeniedException) when calling the GetSecretValue operation: not authorized',
    )
    expect(result.output).toContain('Nothing ran.')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('refuses one secret name for two secrets', async () => {
    await using cli = await createLoginsCli()
    await addSource(
      cli,
      'acme',
      { 'acme-dev': AWS_DEV },
      {
        billing:
          'secrets:\n  TOKEN: { login: acme-dev, ref: billing/dev, field: token }\n',
        payments:
          'secrets:\n  TOKEN: { login: acme-dev, ref: payments/dev, field: token }\n',
      },
    )
    cli.home.seedPickedTools(['acme/billing', 'acme/payments'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Billing and Payments both read a secret named TOKEN, but another one for each. Give one of them another name.',
    )
    expect(cli.bin.calls('aws')).toEqual([])
  })

  test('stops before anything runs on a secret that is not valid', async () => {
    await using cli = await createLoginsCli()
    await addSource(
      cli,
      'acme',
      { data: VAULT_DATA },
      {
        billing: [
          'secrets:',
          '  DB_PASSWORD: { login: data, ref: secret/billing }',
          '  db_token: { login: data, ref: x, field: y }',
          '  TOKEN: { login: missing, ref: x }',
          '  KEY: { ref: x }',
          '',
        ].join('\n'),
      },
    )
    cli.home.seedPickedTools(['acme/billing'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    for (const problem of [
      'Billing: local-env.yml: secrets.db_token: a secret name is uppercase letters, digits and _, like an environment variable (STRIPE_KEY)',
      'Billing: local-env.yml: secrets.KEY.login is required',
      'Billing needs the login missing, which no source declares.',
      'Billing: local-env.yml: secrets.DB_PASSWORD.field is required for a Vault secret: the key of the KV entry',
    ]) {
      expect(result.output).toContain(problem)
    }
    expect(cli.bin.calls('vault')).toEqual([])
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
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
      'Github names ghcr, a registry login: a role can use aws and vault logins only.',
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
  // A terminal: the fake prompts give one, not the compiled binary
  test.skipIf(COMPILED)(
    'logs in to the login it names, with its CLI',
    async () => {
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
    },
  )

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
