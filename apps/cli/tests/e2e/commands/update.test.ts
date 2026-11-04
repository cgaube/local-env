import { buildContainerUpdate } from '#cli-tests/support/factories/dockhand.js'
import packageJson from '#package.json' with { type: 'json' }
import { fakeFormula } from '#cli-tests/support/fake-formula.js'
import { dockerStopped } from '#cli-tests/support/machine.js'
import { COMPILED, createCli } from '#cli-tests/support/run-cli.js'
import {
  createLinkedStack,
  MAIL_V1,
  MAIL_V2,
} from '#cli-tests/support/stacks.js'

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

// Docker is stopped: the update stops right after its first step, local-env
describe.concurrent('local-env update, of local-env itself', () => {
  test('upgrades it with Homebrew, then hands over to the new version', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    cli.bin.on('brew', ['list', 'local-env'])
    cli.bin.on('brew', ['update'])
    cli.bin.on('brew', ['upgrade', 'local-env'])
    cli.bin.on('local-env', ['update'])

    const result = await cli.run(['update', '--yes'], { env: formula.env })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(
      `local-env 99.0.0 is out (you have ${packageJson.version})`,
    )
    expect(result.output).toContain('Upgraded to local-env 99.0.0')
    // brew update first, or brew upgrade can miss the new version
    const brew = cli.bin.calls('brew').map((call) => call.args)
    expect(brew.slice(-2)).toEqual([['update'], ['upgrade', 'local-env']])
    expect(result.output).toContain('Continuing with local-env 99.0.0')
    // The rest of the update runs on the new version, with the same options
    const [next] = cli.bin.calls('local-env')
    expect(next?.args).toEqual(['update', '--yes'])
    expect(next?.env.LOCAL_ENV_UPDATED_FROM).toBe(packageJson.version)
    expect(cli.bin.calls('docker')).toEqual([])
  })

  test('fails with the new version', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    cli.bin.on('brew', ['list', 'local-env'])
    cli.bin.on('brew', ['update'])
    cli.bin.on('brew', ['upgrade', 'local-env'])
    cli.bin.on('local-env', ['update'], { exitCode: 1 })

    const result = await cli.run(['update'], { env: formula.env })

    expect(result.exitCode).toBe(1)
  })

  test('goes on when this is the latest version', async () => {
    await using cli = await createCli()
    using formula = fakeFormula(packageJson.version)
    dockerStopped(cli.bin)

    const result = await cli.run(['update'], { env: formula.env })

    expect(result.output).toContain(
      `local-env ${packageJson.version} is the latest`,
    )
    expect(cli.bin.calls('brew')).toEqual([])
    expect(result.output).toContain('Docker is not running')
  })

  test('says where to download it when brew did not install it', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    cli.bin.on('brew', ['list', 'local-env'], { exitCode: 1 })
    dockerStopped(cli.bin)

    const result = await cli.run(['update'], { env: formula.env })

    expect(result.output).toContain(
      'Not installed with Homebrew: download local-env 99.0.0 from https://github.com/cgaube/local-env/releases/latest',
    )
    expect(cli.bin.calls('local-env')).toEqual([])
  })

  test('only says a new version is out with --dry-run', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    dockerStopped(cli.bin)

    const result = await cli.run(['update', '--dry-run'], { env: formula.env })

    expect(result.output).toContain('Not installed (dry run)')
    expect(cli.bin.calls('brew')).toEqual([])
  })

  test('the new version says where it came from, and checks no more', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    dockerStopped(cli.bin)

    const result = await cli.run(['update'], {
      env: { ...formula.env, LOCAL_ENV_UPDATED_FROM: '0.1.0' },
    })

    expect(result.output).toContain(
      `Updated from 0.1.0 to ${packageJson.version}`,
    )
    expect(formula.requests()).toBe(0)
  })

  test('warns when Homebrew installed the same version', async () => {
    await using cli = await createCli()
    using formula = fakeFormula('99.0.0')
    dockerStopped(cli.bin)

    const result = await cli.run(['update'], {
      env: { ...formula.env, LOCAL_ENV_UPDATED_FROM: packageJson.version },
    })

    expect(result.output).toContain('Homebrew did not install a new version')
    expect(result.output).not.toContain('Updated from')
  })

  test('says it could not check when the formula is out of reach', async () => {
    await using cli = await createCli()
    dockerStopped(cli.bin)

    // The default formula URL of the tests: nothing listens there
    const result = await cli.run(['update'])

    expect(result.output).toContain("Couldn't check for a new version")
  })
})
