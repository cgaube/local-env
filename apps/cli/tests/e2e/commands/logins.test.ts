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

// A source with this manifest, and roles of these files (picked by the test)
const addSourceWith = async (
  cli: Cli,
  name: string,
  manifest: {
    logins: Record<string, unknown>
    secrets?: Record<string, unknown>
  },
  roles: Record<string, Record<string, string>>,
) => {
  const repo = cli.createSource(name, { roles: Object.keys(roles) })
  repo.commit({
    'local-env.yml': buildManifest({ name, ...manifest }),
    ...Object.fromEntries(
      Object.entries(roles).flatMap(([role, files]) =>
        Object.entries(files).map(([path, content]) => [
          `ansible/${role}/${path}`,
          content,
        ]),
      ),
    ),
  })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
}

// A meta/argument_specs.yml with this input: a required secret
const specOf = (name: string) =>
  [
    'argument_specs:',
    '  main:',
    '    options:',
    `      ${name}: { type: str, required: true, no_log: true }`,
    '',
  ].join('\n')

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
    expect((extraVars(cli).local_env as { logins: unknown }).logins).toEqual({
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
    expect((extraVars(cli).local_env as { logins: unknown }).logins).toEqual({
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

  test('fills the inputs of the roles from the secrets of their source, through a pipe', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    cli.bin.on(
      'aws',
      ['secretsmanager', 'get-secret-value', '--secret-id', 'github/dev'],
      {
        env: { AWS_PROFILE: PROFILE },
        // --output json: the SecretString, as a JSON string
        stdout: `${JSON.stringify(JSON.stringify({ token: 'ghp_{{ "x" }}', other: 'no' }))}\n`,
      },
    )
    cli.bin.on('vault', ['token', 'lookup'], {
      stdout: JSON.stringify({ data: { display_name: 'oidc-octocat' } }),
    })
    cli.bin.on('vault', ['kv', 'get', '-field=token', 'secret/npm'], {
      env: { VAULT_ADDR: 'https://vault.acme.test', VAULT_NAMESPACE: 'dev' },
      // vault prints the value with no newline after it
      stdout: 'npm ss',
    })
    await addSourceWith(
      cli,
      'acme',
      {
        logins: { 'acme-dev': AWS_DEV, data: VAULT_DATA },
        secrets: {
          github_token: {
            login: 'acme-dev',
            ref: 'github/dev',
            field: 'token',
          },
          npm_token: { login: 'data', ref: 'secret/npm', field: 'token' },
          // No wanted tool needs it: never read (the fake fails a call it
          // has no rule for)
          deploy_key: { login: 'acme-dev', ref: 'deploy/key' },
        },
      },
      {
        // An input of the spec, a secret Ansible hides
        github: { 'meta/argument_specs.yml': specOf('github_token') },
        // Two roles need it: read once
        gh_cli: { 'meta/argument_specs.yml': specOf('github_token') },
        // Asked for in local-env.yml, without a spec
        node: { 'local-env.yml': 'secrets: [npm_token]\n' },
      },
    )
    cli.home.seedPickedTools(['acme/github', 'acme/gh_cli', 'acme/node'])
    // A value saved by hand: the vault wins
    cli.home.writeJson('volumes/tools/variables.json', {
      github_token: 'saved',
    })

    const result = await cli.run(['install'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Read 2 secrets of the tools: github_token, npm_token',
    )
    expect(
      cli.bin.calls('aws').filter(({ args }) => args[0] === 'secretsmanager'),
    ).toHaveLength(1)
    // Not in the extra vars file, which is on the disk
    expect(extraVars(cli)).toEqual({})
    const files = cli.bin.calls('ansible-playbook').at(-1)?.runFolder ?? {}
    expect(Object.keys(files).length).toBeGreaterThan(0)
    for (const content of Object.values(files)) {
      expect(content).not.toContain('npm ss')
      expect(content).not.toContain('ghp_')
    }
    // Each secret as the variable of its name, as text Ansible never
    // templates
    expect(secretsInput(cli)).toBe(
      [
        'github_token: !unsafe "ghp_{{ \\"x\\" }}"',
        'npm_token: !unsafe "npm ss"',
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
    await addSourceWith(
      cli,
      'acme',
      {
        logins: { 'acme-dev': AWS_DEV },
        secrets: {
          stripe_key: { login: 'acme-dev', ref: 'billing/dev', field: 'key' },
        },
      },
      { billing: { 'local-env.yml': 'secrets: [stripe_key]\n' } },
    )
    cli.home.seedPickedTools(['acme/billing'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Billing: the secret stripe_key (billing/dev key, acme-dev) could not be read: An error occurred (AccessDeniedException) when calling the GetSecretValue operation: not authorized',
    )
    expect(result.output).toContain('Nothing ran.')
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('stops on a binary secret, which is not text', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    // A SecretBinary: no SecretString
    cli.bin.on('aws', ['secretsmanager', 'get-secret-value'], {
      stdout: 'null\n',
    })
    await addSourceWith(
      cli,
      'acme',
      {
        logins: { 'acme-dev': AWS_DEV },
        secrets: { cert: { login: 'acme-dev', ref: 'certs/dev' } },
      },
      { billing: { 'local-env.yml': 'secrets: [cert]\n' } },
    )
    cli.home.seedPickedTools(['acme/billing'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Billing: the secret cert (certs/dev, acme-dev) could not be read: it is not text (a binary secret): local-env reads text only',
    )
    expect(cli.bin.calls('ansible-playbook')).toEqual([])
  })

  test('reads no secret that a role of the run passes in vars:', async () => {
    await using cli = await createLoginsCli()
    await addSourceWith(
      cli,
      'acme',
      {
        logins: { 'acme-dev': AWS_DEV },
        secrets: {
          stripe_key: { login: 'acme-dev', ref: 'billing/dev', field: 'key' },
        },
      },
      {
        billing: { 'local-env.yml': 'secrets: [stripe_key]\n' },
        backend: {
          'meta/main.yml':
            'dependencies:\n  - role: billing\n    vars: { stripe_key: sk_test }\n',
        },
      },
    )
    cli.home.seedPickedTools(['acme/backend'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    // Not even the session: nothing to read
    expect(cli.bin.calls('aws')).toEqual([])
    expect(secretsInput(cli)).toBeUndefined()
  })

  test('refuses one variable that two sources fill with two secrets', async () => {
    await using cli = await createLoginsCli()
    const source = (name: string, ref: string) =>
      addSourceWith(
        cli,
        name,
        {
          logins: { 'acme-dev': AWS_DEV },
          secrets: { github_token: { login: 'acme-dev', ref } },
        },
        {
          [`${name}_gh`]: { 'meta/argument_specs.yml': specOf('github_token') },
        },
      )
    await source('acme', 'acme/github')
    await source('platform', 'platform/github')
    cli.home.seedPickedTools(['acme/acme_gh', 'platform/platform_gh'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      "Acme Gh (acme) and Platform Gh (platform) both get github_token from the secrets of their source, but another secret for each: Ansible's variables are global. Rename it in one of the sources.",
    )
    expect(cli.bin.calls('aws')).toEqual([])
  })

  test('names each secret a role cannot get, before anything runs', async () => {
    await using cli = await createLoginsCli()
    await addSourceWith(
      cli,
      'acme',
      {
        logins: { data: VAULT_DATA },
        secrets: {
          // Vault needs the key of the entry
          db_password: { login: 'data', ref: 'secret/billing' },
          token: { login: 'missing', ref: 'x' },
        },
      },
      {
        billing: {
          'local-env.yml': 'secrets: [db_password, token, not_declared]\n',
        },
      },
    )
    cli.home.seedPickedTools(['acme/billing'])

    const result = await cli.run(['install'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    for (const problem of [
      'acme: local-env.yml: secrets.db_password.field is required for a Vault secret: the key of the KV entry',
      'Billing needs the login missing, which no source declares.',
      'Billing asks for the secret not_declared, which its source acme does not declare in the secrets of its local-env.yml.',
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
      `${TITLE}: not logged in, needed by Github. Nothing ran. In a terminal: local-env login acme/acme-dev`,
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
      'In a terminal: local-env login acme/acme-dev',
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
    // Says what the CLI does before it takes the terminal
    expect(result.output).toContain(
      `◆  acme-dev: the AWS CLI opens your browser to log in\n│  aws sso login --profile ${PROFILE}\n┊`,
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
      'Github names ghcr, a registry login: secrets and tools use aws and vault logins only.',
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

describe.concurrent('local-env sources add, secrets', () => {
  test('refuses a manifest whose secrets are not valid', async () => {
    await using cli = await createLoginsCli()
    const repo = cli.createSource('acme')
    repo.commit({
      'local-env.yml': buildManifest({
        name: 'acme',
        logins: { 'acme-dev': AWS_DEV },
        secrets: { local_env_token: { login: 'acme-dev', ref: 'x' } },
      }),
    })

    const result = await cli.run(['sources', 'add', repo.dir], {
      env: NO_TTY,
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'secrets.local_env_token: a secret is named after the variable it fills',
    )
    expect(cli.home.exists('volumes/sources/acme')).toBe(false)
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

describe.concurrent('local-env login, aws and vault', () => {
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

      const result = await cli.run(['login', 'acme/acme-dev'])

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        'acme-dev: the AWS CLI opens your browser to log in',
      )
      expect(result.output).toContain(
        `✔ acme/acme-dev  AWS 123456789012 (Dev)  logged in as ${ARN}`,
      )
      // Configured first: the profile must exist for `aws sso login`
      expect(awsConfig(cli)).toContain(`[profile ${PROFILE}]`)
    },
  )

  test.skipIf(COMPILED)(
    'offers to log in to the sessions that are logged out',
    async () => {
      await using cli = await createLoginsCli()
      const session = join(cli.root, 'session')
      cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
      cli.bin.on('aws', ['sts', 'get-caller-identity'], {
        ...LOGGED_IN,
        ifFile: session,
      })
      cli.bin.on('aws', ['sso', 'login'], { touch: session })
      cli.bin.on('vault', ['token', 'lookup'], {
        stdout: JSON.stringify({ data: { display_name: 'oidc-octocat' } }),
      })
      await addSource(
        cli,
        'acme',
        { 'acme-dev': AWS_DEV, data: VAULT_DATA },
        {},
      )

      const result = await cli.run(['login'], {
        answers: [
          {
            ask: 'acme/acme-dev (AWS 123456789012 (Dev)): logged out. Log in now?',
            answer: true,
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        '✔ acme/data  Vault vault.acme.test (dev)  logged in as oidc-octocat',
      )
      expect(
        cli.bin.calls('aws').filter(({ args }) => args[0] === 'sso'),
      ).toHaveLength(1)
    },
  )

  // The user's own profile, in ~/.aws/config
  const ownProfile = (cli: Cli, lines: string[]) => {
    mkdirSync(join(cli.root, 'user/.aws'), { recursive: true })
    writeFileSync(
      join(cli.root, 'user/.aws/config'),
      ['[profile acme]', ...lines, ''].join('\n'),
    )
  }
  const OWN = {
    type: 'aws',
    profile: 'acme',
    help: 'Run the onboarding script',
  }

  test.skipIf(COMPILED)(
    'logs in to your own AWS SSO profile with aws sso login',
    async () => {
      await using cli = await createLoginsCli()
      ownProfile(cli, ['sso_session = acme', 'sso_account_id = 123456789012'])
      const session = join(cli.root, 'session')
      cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
      cli.bin.on('aws', ['sts', 'get-caller-identity'], {
        ...LOGGED_IN,
        ifFile: session,
      })
      cli.bin.on('aws', ['sso', 'login', '--profile', 'acme'], {
        touch: session,
      })
      await addSource(cli, 'acme', { own: OWN }, {})

      const result = await cli.run(['login', 'acme/own'])

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(
        `✔ acme/own  AWS profile acme  logged in as ${ARN}`,
      )
      // Your own profile: local-env writes nothing in it
      expect(awsConfig(cli)).toBe(
        '[profile acme]\nsso_session = acme\nsso_account_id = 123456789012\n',
      )
    },
  )

  test.skipIf(COMPILED)(
    'leaves a profile that runs a program to its program',
    async () => {
      await using cli = await createLoginsCli()
      ownProfile(cli, [
        'credential_process = granted credential-process --profile acme',
      ])
      cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
      await addSource(cli, 'acme', { own: OWN }, {})

      const result = await cli.run(['login', 'acme/own'])

      expect(result.exitCode).toBe(1)
      expect(result.output).toContain(
        'local-env cannot log in to AWS profile acme for you: your own profile logs in its own way. Run the onboarding script',
      )
      expect(
        cli.bin.calls('aws').filter(({ args }) => args[0] === 'sso'),
      ).toEqual([])
    },
  )

  test('needs your own terminal', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], NO_TOKEN)
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV }, {})

    const result = await cli.run(['login', 'acme-dev'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'acme/acme-dev (AWS 123456789012 (Dev)): logged out. Run `local-env login acme/acme-dev` in your own terminal',
    )
    expect(
      cli.bin.calls('aws').filter(({ args }) => args[0] === 'sso'),
    ).toEqual([])
  })
})

describe.concurrent('local-env logout, aws and vault', () => {
  test('logs out of a session', async () => {
    await using cli = await createLoginsCli()
    cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
    cli.bin.on('aws', ['sso', 'logout'])
    await addSource(cli, 'acme', { 'acme-dev': AWS_DEV }, {})

    const result = await cli.run(['logout', 'acme/acme-dev'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Logged out of acme/acme-dev (AWS 123456789012 (Dev))',
    )
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
      'acme-dev  AWS 123456789012 (Dev)  logged out: local-env login acme/acme-dev',
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
      `${TITLE}: not logged in, needed by acme. Run \`local-env login acme/acme-dev\`.`,
    )
  })
})
