import {
  buildDockhandStack,
  provisionedDockhand,
} from '#cli-tests/support/factories/dockhand.js'
import { buildManifest } from '#cli-tests/support/factories/manifest.js'
import { buildTemplate } from '#cli-tests/support/factories/template.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { type Cli, COMPILED, createCli } from '#cli-tests/support/run-cli.js'

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

const MAIL = [
  'name: mailpit',
  'services:',
  '  mail:',
  '    image: axllent/mailpit:latest',
  '    environment:',
  '      MP_UI_AUTH: admin:${ADMIN_PASSWORD:?a password for the web UI}',
  '      MP_SMTP_AUTH: user:${SMTP_PASSWORD:?the SMTP password}',
  '      TZ: ${TZ:-UTC}',
  '',
].join('\n')

const WIKI = [
  'name: wiki',
  'services:',
  '  wiki:',
  '    image: wiki',
  '    environment:',
  '      VIRTUAL_HOST: wiki',
  '',
].join('\n')

const createDeployCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  cli.home.seedCertificate()
  machineReady(cli)
  return cli
}

// acme: mail (a variable to give, a secret from AWS) and wiki
const addAcme = async (cli: Cli) => {
  const repo = cli.createSource('acme', {
    templates: [
      buildTemplate({ folder: 'mail', title: 'Mailpit', compose: MAIL }),
      buildTemplate({ folder: 'wiki', title: 'Wiki', compose: WIKI }),
    ],
  })
  repo.commit({
    'local-env.yml': buildManifest({
      name: 'acme',
      logins: { 'acme-dev': AWS_DEV },
      secrets: {
        SMTP_PASSWORD: {
          login: 'acme-dev',
          ref: 'mail/dev',
          field: 'password',
        },
      },
    }),
  })
  const added = await cli.run(['sources', 'add', repo.dir], { env: NO_TTY })
  expect(added.exitCode).toBe(0)
}

const stackNamed = (cli: Cli, name: string) =>
  cli.dockhand.state.stacks.find((stack) => stack.name === name)

describe.concurrent('local-env deploy', () => {
  test.skipIf(COMPILED)(
    'deploys a template with the variable it asks for and its secret, linked',
    async () => {
      await using cli = await createDeployCli()
      cli.bin.on('which', ['aws'])
      cli.bin.on('aws', ['sts', 'get-caller-identity'], {
        stdout: JSON.stringify({ Arn: 'arn:aws:sts::1:assumed-role/Dev/me' }),
      })
      cli.bin.on(
        'aws',
        ['secretsmanager', 'get-secret-value', '--secret-id', 'mail/dev'],
        {
          stdout: `${JSON.stringify(JSON.stringify({ password: 's3cret' }))}\n`,
        },
      )
      await addAcme(cli)

      const result = await cli.run(['deploy', 'acme/mail'], {
        answers: [
          { ask: 'Deploy Mailpit (acme/mail) in Docker?', answer: true },
          {
            ask: 'mailpit: ADMIN_PASSWORD (a password for the web UI)',
            answer: 'admin-pw',
          },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('mailpit deployed')
      // MP_SMTP_AUTH: user:${SMTP_PASSWORD} is a map entry of another name
      expect(result.output).toContain(
        'mailpit: Dockhand shows SMTP_PASSWORD in clear in its pages. The template hides it in the list form of environment: - NAME=${SMTP_PASSWORD}.',
      )
      expect(stackNamed(cli, 'mailpit')?.variables).toEqual([
        { key: 'ADMIN_PASSWORD', value: 'admin-pw', isSecret: true },
        { key: 'SMTP_PASSWORD', value: 's3cret', isSecret: true },
      ])
      // Linked from the start: sync merges the template's changes
      expect(
        cli.home.readJson<Record<string, { template: string }>>(
          'volumes/template-links.json',
        ).mailpit?.template,
      ).toBe('acme/mail')
      // Not a stack a tool needs: install doesn't keep it
      expect(cli.home.exists('volumes/tools/stacks.json')).toBe(false)
    },
  )

  test('finds a template by its name alone, and deploys with --yes', async () => {
    await using cli = await createDeployCli()
    await addAcme(cli)

    const result = await cli.run(['deploy', 'wiki', '--yes'], { env: NO_TTY })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('wiki deployed')
    expect(stackNamed(cli, 'wiki')).toBeDefined()
    // Where the app is
    expect(result.output).toContain('https://wiki.local-env-e2e.test')
  })

  test('leaves a template that is deployed already', async () => {
    await using cli = await createDeployCli()
    await addAcme(cli)
    cli.dockhand.state.stacks.push(
      buildDockhandStack({ name: 'wiki', content: WIKI }),
    )

    const result = await cli.run(['deploy', 'acme/wiki', '--yes'], {
      env: NO_TTY,
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('wiki is deployed already')
    expect(
      cli.dockhand.requests.filter(
        ({ method, path }) => method === 'POST' && path.startsWith('/stacks'),
      ),
    ).toEqual([])
  })

  test('without a terminal, does not deploy a template that asks for a value', async () => {
    await using cli = await createDeployCli()
    await addAcme(cli)
    cli.bin.on('which', ['aws'])
    cli.bin.on('aws', ['sts', 'get-caller-identity'], {
      stdout: JSON.stringify({ Arn: 'arn:aws:sts::1:assumed-role/Dev/me' }),
    })
    cli.bin.on('aws', ['secretsmanager', 'get-secret-value'], {
      stdout: `${JSON.stringify(JSON.stringify({ password: 'x' }))}\n`,
    })

    const result = await cli.run(['deploy', 'acme/mail', '--yes'], {
      env: NO_TTY,
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'mailpit needs ADMIN_PASSWORD: not deployed. Run local-env deploy acme/mail in a terminal to set it.',
    )
    expect(stackNamed(cli, 'mailpit')).toBeUndefined()
  })

  test('without a name or a terminal, lists the templates', async () => {
    await using cli = await createDeployCli()
    await addAcme(cli)

    const result = await cli.run(['deploy'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Mailpit (acme/mail)')
    expect(result.output).toContain('Wiki (acme/wiki)')
    expect(result.output).toContain(
      'Name a template: local-env deploy <source>/<template>',
    )
  })

  test('says which sources have a name more than one has', async () => {
    await using cli = await createDeployCli()
    await addAcme(cli)
    const other = cli.createSource('other', {
      templates: [buildTemplate({ folder: 'wiki', compose: WIKI })],
    })
    await cli.run(['sources', 'add', other.dir], { env: NO_TTY })

    const result = await cli.run(['deploy', 'wiki', '--yes'], { env: NO_TTY })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Several sources have wiki: acme/wiki, other/wiki. Name one of them.',
    )
  })
})
