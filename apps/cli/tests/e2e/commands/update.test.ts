import { buildContainerUpdate } from '../../support/factories/dockhand.js'
import { dockerStopped } from '../../support/machine.js'
import { COMPILED } from '../../support/run-cli.js'
import { createLinkedStack, MAIL_V1, MAIL_V2 } from '../../support/stacks.js'

const compose = (args: string[]) => (call: { args: string[] }) =>
  call.args[0] === 'compose' && args.every((arg) => call.args.includes(arg))

// A linked stack whose template changed, and a container with a newer image
const createOutdated = async () => {
  const linked = await createLinkedStack()
  linked.publish(MAIL_V2)
  linked.cli.dockhand.state.containerUpdates = [
    buildContainerUpdate({ containerName: 'redis-1' }),
    // Updated by Dockhand itself, or not at all
    buildContainerUpdate({ containerName: 'dockhand', systemContainer: 'x' }),
    buildContainerUpdate({ containerName: 'site-1', updateDisabled: true }),
  ]
  return linked
}

describe.concurrent('local-env update', () => {
  test('--dry-run lists the changes and touches nothing', async () => {
    const { cli, stack } = await createOutdated()
    await using _ = cli

    const result = await cli.run(['update', '--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Template changed: mail')
    expect(result.output).toContain('Updates available for redis-1')
    expect(result.output).toContain('Dry run: nothing was changed')
    expect(stack().content).toBe(MAIL_V1)
    expect(cli.dockhand.state.updatedContainers).toEqual([])
    const calls = cli.bin.calls('docker')
    expect(calls.some(compose(['pull']))).toBe(false)
    expect(calls.some((call) => call.args.includes('prune'))).toBe(false)
  })

  test('--yes updates the core stack, the stacks and the images', async () => {
    const { cli, stack } = await createOutdated()
    await using _ = cli

    const result = await cli.run(['update', '--yes'])

    expect(result.exitCode).toBe(0)
    const calls = cli.bin.calls('docker')
    expect(calls.some(compose(['pull', '--ignore-buildable']))).toBe(true)
    expect(calls.some(compose(['build', '--pull']))).toBe(true)
    expect(calls.some(compose(['up', '--remove-orphans']))).toBe(true)
    expect(stack().content).toBe(MAIL_V2)
    expect(cli.dockhand.state.updatedContainers).toEqual(['redis-1'])
    expect(result.output).toContain('Stacks synced: mail')
    expect(result.output).toContain('Images updated: redis-1')
    expect(result.output).toContain('Pruned old images (0B reclaimed)')
  })

  test.skipIf(COMPILED)(
    'reviews the template changes on approval',
    async () => {
      const { cli, stack } = await createOutdated()
      await using _ = cli

      const result = await cli.run(['update'], {
        answers: [
          { ask: 'Review and sync them now?', answer: true },
          { ask: 'Apply template changes to "mail"', answer: 'apply' },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(stack().content).toBe(MAIL_V2)
    },
  )

  test.skipIf(COMPILED)('leaves the review to `sources sync`', async () => {
    const { cli, stack } = await createOutdated()
    await using _ = cli

    const result = await cli.run(['update'], {
      answers: [{ ask: 'Review and sync them now?', answer: false }],
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      'Run `local-env sources sync` to review them',
    )
    expect(stack().content).toBe(MAIL_V1)
    // The images are updated anyway
    expect(cli.dockhand.state.updatedContainers).toEqual(['redis-1'])
  })

  test('says when everything is up to date', async () => {
    const { cli } = await createLinkedStack()
    await using _ = cli

    const result = await cli.run(['update'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Stacks up to date with their templates')
    expect(result.output).toContain('All containers up to date')
  })

  test('fails when Docker is not running', async () => {
    const { cli } = await createLinkedStack()
    await using _ = cli
    dockerStopped(cli.bin)

    const result = await cli.run(['update'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Docker is not running')
  })
})
