import { buildDockhandStack } from '../../support/factories/dockhand.js'
import { COMPILED } from '../../support/run-cli.js'
import {
  createLinkedStack,
  MAIL_V1,
  MAIL_V2,
  withUserEdit,
} from '../../support/stacks.js'

const APPLY = 'Apply template changes to "mail" and redeploy?'

describe.concurrent('local-env sources sync', () => {
  test('links a stack to the template with the same name', async () => {
    const { cli, link } = await createLinkedStack()
    await using _ = cli

    const result = await cli.run(['sources', 'sync'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('mail (acme/mail): up to date')
    expect(link()).toMatchObject({
      template: 'acme/mail',
      how: 'name',
      base: expect.stringMatching(/^[0-9a-f]{12}$/),
    })
  })

  test.skipIf(COMPILED)(
    'pulls the template change and applies it on approval',
    async () => {
      const { cli, publish, stack, link } = await createLinkedStack()
      await using _ = cli
      const before = link()?.base
      publish(MAIL_V2)

      const result = await cli.run(['sources', 'sync'], {
        answers: [{ ask: APPLY, answer: 'apply' }],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('mail (acme/mail): template changed')
      expect(result.output).toContain('-    image: axllent/mailpit:v1')
      expect(result.output).toContain('+    image: axllent/mailpit:v2')
      expect(result.output).toContain('mail: updated and redeployed')
      expect(stack().content).toBe(MAIL_V2)
      expect(link()?.base).not.toBe(before)
    },
  )

  test('keeps the edits made to the stack', async () => {
    const { cli, publish, stack } = await createLinkedStack({
      content: withUserEdit(MAIL_V1),
    })
    await using _ = cli
    publish(MAIL_V2)

    const result = await cli.run(['sources', 'sync', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(stack().content).toBe(withUserEdit(MAIL_V2))
  })

  test('--yes leaves a conflicting change for review', async () => {
    const { cli, publish, stack } = await createLinkedStack({
      content: MAIL_V1.replace('mailpit:v1', 'mailpit:v1.5'),
    })
    await using _ = cli
    publish(MAIL_V2)

    const result = await cli.run(['sources', 'sync', '--yes'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      '1 part(s) changed both in this stack and in the template',
    )
    expect(result.output).toContain('mail: skipped, review it without --yes')
    expect(stack().content).toContain('mailpit:v1.5')
  })

  test.skipIf(COMPILED)(
    'skipping a version stops asking until the template changes again',
    async () => {
      const { cli, publish, stack, link } = await createLinkedStack()
      await using _ = cli
      publish(MAIL_V2)

      await cli.run(['sources', 'sync'], {
        answers: [{ ask: APPLY, answer: 'skip' }],
      })
      const again = await cli.run(['sources', 'sync'])

      expect(link()?.skip).toEqual(expect.any(String))
      expect(again.output).toContain(
        'mail (acme/mail): template version skipped',
      )
      expect(again.questions).toEqual([])
      expect(stack().content).toBe(MAIL_V1)

      publish(MAIL_V2.replace('mailpit:v2', 'mailpit:v3'))
      const next = await cli.run(['sources', 'sync'], {
        answers: [{ ask: APPLY, answer: 'apply' }],
      })
      expect(next.exitCode).toBe(0)
      expect(stack().content).toContain('mailpit:v3')
    },
  )

  test.skipIf(COMPILED)('unlinking stops the syncs for good', async () => {
    const { cli, publish, link } = await createLinkedStack()
    await using _ = cli
    publish(MAIL_V2)

    await cli.run(['sources', 'sync'], {
      answers: [{ ask: APPLY, answer: 'unlink' }],
    })
    const again = await cli.run(['sources', 'sync'])

    // Wins over the matching name:
    expect(link()).toEqual({ ignored: true })
    expect(again.output).toContain('No stacks deployed from a template')
  })

  test.skipIf(COMPILED)('"not now" asks again next time', async () => {
    const { cli, publish, stack } = await createLinkedStack()
    await using _ = cli
    publish(MAIL_V2)

    const first = await cli.run(['sources', 'sync'], {
      answers: [{ ask: APPLY, answer: 'later' }],
    })
    const second = await cli.run(['sources', 'sync'], {
      answers: [{ ask: APPLY, answer: 'later' }],
    })

    expect(first.output).toContain('mail: left unchanged')
    expect(second.questions).toEqual([APPLY])
    expect(stack().content).toBe(MAIL_V1)
  })

  test('--dry-run shows the change and applies nothing', async () => {
    const { cli, publish, stack } = await createLinkedStack()
    await using _ = cli
    publish(MAIL_V2)

    const result = await cli.run(['sources', 'sync', '--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('+    image: axllent/mailpit:v2')
    expect(result.questions).toEqual([])
    expect(stack().content).toBe(MAIL_V1)
  })

  test('--no-pull compares with the sources as they are', async () => {
    const { cli, publish } = await createLinkedStack()
    await using _ = cli
    publish(MAIL_V2)

    const result = await cli.run(['sources', 'sync', '--no-pull'])

    expect(result.output).toContain('mail (acme/mail): up to date')
  })

  test('warns about new variables the stack does not set', async () => {
    const { cli, publish } = await createLinkedStack()
    await using _ = cli
    publish(
      MAIL_V2.replace(
        "      VIRTUAL_PORT: '8025'\n",
        "      VIRTUAL_PORT: '8025'\n      MP_UI_AUTH: ${MAIL_PASSWORD}\n",
      ),
    )

    const result = await cli.run(['sources', 'sync', '--dry-run'])

    expect(result.output).toContain(
      'New required variables not set on the stack: MAIL_PASSWORD',
    )
  })

  test.skipIf(COMPILED)(
    'offers to link a stack that uses a template image, once',
    async () => {
      const { cli, link } = await createLinkedStack()
      await using _ = cli
      const mailpit =
        'services:\n  mailpit:\n    image: axllent/mailpit:latest\n'
      cli.dockhand.state.stacks.push(
        buildDockhandStack({ name: 'mailpit', content: mailpit }),
      )

      const first = await cli.run(['sources', 'sync'], {
        answers: [
          {
            ask: 'mailpit uses the image of the template acme/mail',
            answer: 'ignore',
          },
        ],
      })
      const second = await cli.run(['sources', 'sync'])

      expect(first.exitCode).toBe(0)
      expect(second.questions).toEqual([])
      const links = cli.home.readJson<Record<string, unknown>>(
        'volumes/template-links.json',
      )
      expect(links.mailpit).toEqual({ ignored: true })
      expect(link()).toMatchObject({ template: 'acme/mail' })
    },
  )

  test.skipIf(COMPILED)(
    'rebuilds a stack whose build folder changed',
    async () => {
      const compose = [
        'name: mail',
        'services:',
        '  mail:',
        '    build: ./app',
        '',
      ].join('\n')
      const { cli, repo } = await createLinkedStack({
        files: {
          'docker/mail/compose.yaml': compose,
          'docker/mail/app/Dockerfile': 'FROM axllent/mailpit:v1\n',
        },
      })
      await using _ = cli
      // The build folder changes, the compose file doesn't
      repo.commit({ 'docker/mail/app/Dockerfile': 'FROM axllent/mailpit:v2\n' })

      const result = await cli.run(['sources', 'sync'], {
        answers: [{ ask: 'Rebuild and redeploy mail?', answer: true }],
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('mail: rebuilt and redeployed')
      expect(cli.dockhand.state.builtStacks).toEqual(['mail'])
    },
  )

  test('rejects an unknown source', async () => {
    const { cli } = await createLinkedStack()
    await using _ = cli

    const result = await cli.run(['sources', 'sync', 'nope'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No source named "nope"')
  })
})

describe('local-env sources links', () => {
  test('lists the linked stacks and their status', async () => {
    const { cli, publish } = await createLinkedStack()
    await using _ = cli
    cli.dockhand.state.stacks.push(
      buildDockhandStack({
        name: 'mailpit',
        content: 'services:\n  mailpit:\n    image: axllent/mailpit:latest\n',
      }),
    )
    publish(MAIL_V2)
    await cli.run(['sources', 'sync', '--dry-run'])

    const result = await cli.run(['sources', 'links'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })

  test('--forget drops what was recorded for a stack', async () => {
    const { cli } = await createLinkedStack()
    await using _ = cli

    const forgot = await cli.run(['sources', 'links', '--forget', 'mail'])
    const again = await cli.run(['sources', 'links', '--forget', 'mail'])

    expect(forgot.output).toContain('Forgot mail')
    expect(again.output).toContain('mail: nothing recorded for this stack')
  })
})
