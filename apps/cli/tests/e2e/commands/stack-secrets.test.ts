import {
  buildDockhandStack,
  provisionedDockhand,
} from '#cli-tests/support/factories/dockhand.js'
import { buildManifest } from '#cli-tests/support/factories/manifest.js'
import { buildTemplate } from '#cli-tests/support/factories/template.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { type Cli, createCli } from '#cli-tests/support/run-cli.js'

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
}
const LOGGED_IN = {
  stdout: JSON.stringify({
    Arn: 'arn:aws:sts::123456789012:assumed-role/Dev/me',
  }),
}

// --output json: the SecretString, as a JSON string
const awsSecret = (value: unknown) => ({
  stdout: `${JSON.stringify(JSON.stringify(value))}\n`,
})

const MAIL = (version: string) =>
  [
    'name: mail',
    'services:',
    '  mail:',
    `    image: axllent/mailpit:${version}`,
    '    environment:',
    '      MP_SMTP_AUTH: user:${SMTP_PASSWORD:?the SMTP password}',
    '      MP_TZ: ${TZ:-UTC}',
    '',
  ].join('\n')

const SECRETS = {
  SMTP_PASSWORD: { login: 'acme-dev', ref: 'mail/dev', field: 'password' },
}

const createStacksCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  cli.bin.on('which', ['ansible-playbook'])
  cli.bin.on('ansible-playbook', [])
  cli.bin.on('which', ['aws'])
  cli.bin.on('aws', ['sts', 'get-caller-identity'], LOGGED_IN)
  return cli
}

// The source acme: the mail template, its secret from AWS, and a role that
// needs the stack
const addAcme = async (cli: Cli) => {
  const repo = cli.createSource('acme', {
    roles: ['mailer'],
    templates: [buildTemplate({ folder: 'mail', compose: MAIL('v1') })],
  })
  repo.commit({
    'local-env.yml': buildManifest({
      name: 'acme',
      logins: { 'acme-dev': AWS_DEV },
      secrets: SECRETS,
    }),
    'ansible/mailer/local-env.yml': 'stacks: [mail]\n',
  })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
  return repo
}

const mailStack = (cli: Cli) =>
  cli.dockhand.state.stacks.find(({ name }) => name === 'mail')

describe.concurrent('local-env install, stack secrets', () => {
  test('deploys the stack a tool needs with its secret, never asked', async () => {
    await using cli = await createStacksCli()
    cli.bin.on(
      'aws',
      ['secretsmanager', 'get-secret-value', '--secret-id', 'mail/dev'],
      awsSecret({ password: 's3cret {{ x }}' }),
    )
    await addAcme(cli)
    cli.home.seedPickedTools(['acme/mailer'])

    const result = await cli.run(['install', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.questions).toEqual([])
    expect(result.output).toContain('Read the secret of mail: SMTP_PASSWORD')
    expect(mailStack(cli)?.variables).toEqual([
      { key: 'SMTP_PASSWORD', value: 's3cret {{ x }}', isSecret: true },
    ])
  })
})

describe.concurrent('local-env sources sync, stack secrets', () => {
  // A stack in Dockhand, linked to the mail template by its name
  const withMailStack = async (
    variables: { key: string; value: string; isSecret: boolean }[],
  ) => {
    const cli = await createStacksCli()
    cli.bin.on(
      'aws',
      ['secretsmanager', 'get-secret-value', '--secret-id', 'mail/dev'],
      awsSecret({ password: 'first' }),
    )
    const repo = await addAcme(cli)
    cli.dockhand.state.stacks.push(
      buildDockhandStack({ name: 'mail', content: MAIL('v1'), variables }),
    )
    return { cli, repo }
  }

  test('says when a stack was deployed without its secret, and leaves it', async () => {
    const { cli } = await withMailStack([
      { key: 'TZ', value: 'Europe/Paris', isSecret: false },
    ])
    await using _ = cli

    const result = await cli.run(['sources', 'sync', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'mail: deployed without SMTP_PASSWORD from the vault. Remove it in Dockhand, then run local-env deploy acme/mail, or set it in Dockhand.',
    )
    // The template's fix, said too
    expect(result.output).toContain(
      'mail: Dockhand shows SMTP_PASSWORD in clear in its pages.',
    )
    expect(mailStack(cli)?.variables).toEqual([
      { key: 'TZ', value: 'Europe/Paris', isSecret: false },
    ])
    expect(cli.dockhand.state.builtStacks).not.toContain('mail')
  })

  test('reads the secret again before a template change redeploys the stack', async () => {
    const { cli, repo } = await withMailStack([
      { key: 'SMTP_PASSWORD', value: 'first', isSecret: true },
    ])
    await using _ = cli
    await cli.run(['sources', 'sync', '--yes'])
    // Rotated in the vault, then a new version of the template
    cli.bin.on(
      'aws',
      ['secretsmanager', 'get-secret-value', '--secret-id', 'mail/dev'],
      awsSecret({ password: 'rotated' }),
    )
    repo.commit({ 'docker/mail/compose.yaml': MAIL('v2') }, 'v2')

    const result = await cli.run(['sources', 'sync', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('mail: updated and redeployed')
    expect(mailStack(cli)?.variables).toContainEqual({
      key: 'SMTP_PASSWORD',
      value: 'rotated',
      isSecret: true,
    })
    // Saved before the compose file that uses it
    const writes = cli.dockhand.requests
      .filter(({ method }) => method === 'PUT')
      .map(({ path }) => path)
    expect(writes.slice(-2)).toEqual([
      '/stacks/mail/env',
      '/stacks/mail/compose',
    ])
  })

  test('leaves a stack as it is when its secret cannot be read', async () => {
    const { cli, repo } = await withMailStack([
      { key: 'SMTP_PASSWORD', value: 'first', isSecret: true },
    ])
    await using _ = cli
    await cli.run(['sources', 'sync', '--yes'])
    cli.bin.on('aws', ['secretsmanager', 'get-secret-value'], {
      exitCode: 254,
      stderr: 'An error occurred (AccessDeniedException): not authorized',
    })
    repo.commit({ 'docker/mail/compose.yaml': MAIL('v2') }, 'v2')

    const result = await cli.run(['sources', 'sync', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'mail: the secret SMTP_PASSWORD (mail/dev password, acme-dev) could not be read: An error occurred (AccessDeniedException): not authorized',
    )
    expect(result.output).toContain(
      'mail: not redeployed, its secrets are missing',
    )
    expect(mailStack(cli)?.content).toBe(MAIL('v1'))
    expect(mailStack(cli)?.variables).toEqual([
      { key: 'SMTP_PASSWORD', value: 'first', isSecret: true },
    ])
  })
})
