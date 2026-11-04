import { dockerRunning } from '#cli-tests/support/machine.js'
import {
  buildDockhandEnvironment,
  buildDockhandRegistry,
} from '#cli-tests/support/factories/dockhand.js'
import {
  buildContainerTemplate,
  buildTemplate,
} from '#cli-tests/support/factories/template.js'
import type { DockhandState } from '#cli-tests/support/fake-dockhand.js'
import { createCli } from '#cli-tests/support/run-cli.js'

// A provisioned Dockhand: adding or removing a source only changes its
// template sources
const createProvisionedCli = (dockhand: Partial<DockhandState> = {}) =>
  createCli({
    dockhand: {
      ...dockhand,
      environments: [buildDockhandEnvironment()],
      exposure: { warn: true, dismissed: true },
      updateChecks: {
        1: { enabled: true, autoUpdate: true, cron: '0 10,14 * * 1-5' },
      },
    },
  })

describe.concurrent('local-env sources add', () => {
  test('clones a local repo and registers its templates in Dockhand', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const repo = cli.createSource('acme')

    const result = await cli.run(['sources', 'add', repo.dir])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Cloned acme')
    expect(cli.home.exists('volumes/sources/acme/docker/templates.json')).toBe(
      true,
    )
    // The build context catalog-server serves to Docker's builder
    expect(cli.home.exists('volumes/build-contexts/acme.git')).toBe(true)
    expect(cli.dockhand.state.templateSources).toEqual([
      expect.objectContaining({
        name: 'acme',
        url: expect.stringMatching(
          /^http:\/\/catalog-server:8080\/acme\/templates\.json\?v=[0-9a-f]{12}$/,
        ),
      }),
    ])
  })

  test('uses --name instead of the repo name', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const repo = cli.createSource('templates')

    const result = await cli.run(['sources', 'add', repo.dir, '-n', 'team'])

    expect(result.exitCode).toBe(0)
    expect(cli.home.exists('volumes/sources/team')).toBe(true)
  })

  test('refuses a folder that is not a git repo', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()

    const result = await cli.run(['sources', 'add', cli.home.path('nope')])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('is not a git repo')
  })

  test('refuses the same repo twice', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const repo = cli.createSource('acme')
    await cli.run(['sources', 'add', repo.dir])

    const result = await cli.run(['sources', 'add', `${repo.dir}/`])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('is already added, as "acme"')
  })
})

describe('local-env sources list', () => {
  test('says how to add the first source', async () => {
    await using cli = await createCli()

    const result = await cli.run(['sources', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No sources')
  })

  test('summarizes the content of each source', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const acme = cli.createSource('acme', {
      templates: [buildTemplate({ folder: 'mail' }), buildTemplate()],
      containers: [buildContainerTemplate()],
      roles: ['php'],
    })
    const empty = cli.createSource('empty', { templates: [] })
    await cli.run(['sources', 'add', acme.dir])
    await cli.run(['sources', 'add', empty.dir])

    const result = await cli.run(['sources', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })

  test('shows whether the sources that need a registry login have one', async () => {
    await using cli = await createProvisionedCli({
      registries: [buildDockhandRegistry()],
    })
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const needs = (name: string, hosts: string[]) => {
      const repo = cli.createSource(name)
      repo.commit({
        'docker/registries.json': JSON.stringify(
          hosts.map((host) => ({ host })),
        ),
      })
      return repo
    }
    const sources = [
      needs('acme', ['ghcr.io']),
      needs('beta', ['ghcr.io', 'quay.io']),
      cli.createSource('plain'),
    ]
    for (const repo of sources) {
      await cli.run(['sources', 'add', repo.dir], {
        env: { FAKE_PROMPTS_NO_TTY: '1' },
      })
    }

    const result = await cli.run(['sources', 'list'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })
})

describe.concurrent('local-env sources remove', () => {
  test('deletes the clone and unregisters it from Dockhand', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const repo = cli.createSource('acme')
    await cli.run(['sources', 'add', repo.dir])

    const result = await cli.run(['sources', 'remove', 'acme'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Removed acme')
    expect(cli.home.exists('volumes/sources/acme')).toBe(false)
    expect(cli.home.exists('volumes/build-contexts/acme.git')).toBe(false)
    expect(cli.dockhand.state.templateSources).toEqual([])
  })

  test('needs a name when it cannot ask', async () => {
    await using cli = await createProvisionedCli()
    cli.home.seedConfig()
    dockerRunning(cli.bin)
    const repo = cli.createSource('acme')
    await cli.run(['sources', 'add', repo.dir])

    const result = await cli.run(['sources', 'remove'])

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Name the source to remove')
    expect(cli.home.exists('volumes/sources/acme')).toBe(true)
  })
})
