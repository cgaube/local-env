import { provisionedDockhand } from '#cli-tests/support/factories/dockhand.js'
import { machineReady } from '#cli-tests/support/machine.js'
import { COMPILED, createCli, type Cli } from '#cli-tests/support/run-cli.js'

const createVarsCli = async () => {
  const cli = await createCli({ dockhand: provisionedDockhand() })
  cli.home.seedConfig()
  machineReady(cli)
  return cli
}

// git takes an email (required), an editor (choices), a switch, a number of
// jobs, a list of aliases and a token (a secret). The backend profile
// includes it and sets its editor.
const sourceWithVariables = async (cli: Cli) => {
  const acme = cli.createSource('acme', { roles: ['git', 'backend', 'node'] })
  acme.commit({
    'ansible/git/meta/argument_specs.yml': [
      'argument_specs:',
      '  main:',
      '    options:',
      '      git_email: { required: true }',
      '      git_editor: { choices: [vim, nano, code], default: vim }',
      '      git_sign: { type: bool }',
      '      git_jobs: { type: int }',
      '      git_aliases: { type: list }',
      '      git_token: { no_log: true }',
      '',
    ].join('\n'),
    'ansible/node/meta/argument_specs.yml':
      'argument_specs:\n  main:\n    options:\n      node_version: {}\n',
    'ansible/backend/meta/main.yml': [
      'galaxy_info:',
      '  galaxy_tags: [profile]',
      'dependencies:',
      '  - role: git',
      '    vars:',
      '      git_editor: code',
      '',
    ].join('\n'),
  })
  await cli.run(['sources', 'add', acme.dir])
  return acme
}

const savedVariables = (cli: Cli) =>
  cli.home.readJson('volumes/tools/variables.json')

// Snapshots can't run concurrently
describe('local-env vars list', () => {
  test('lists the variables of your tools, then the saved ones they no longer use', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)
    cli.home.seedPickedTools(['acme/git'])
    cli.home.writeJson('volumes/tools/variables.json', {
      git_sign: true,
      node_version: '22',
    })

    const result = await cli.run(['vars'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchSnapshot()
  })
})

describe.concurrent('local-env vars set', () => {
  test('saves a value of the type of the variable', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)
    cli.home.seedPickedTools(['acme/git'])

    for (const [name, value] of [
      ['git_email', 'me@acme.test'],
      ['git_editor', 'nano'],
      ['git_sign', 'yes'],
      ['git_jobs', '4'],
      ['git_aliases', 'co, br'],
    ]) {
      const result = await cli.run(['vars', 'set', name!, value!])
      expect(result.exitCode).toBe(0)
    }

    expect(savedVariables(cli)).toEqual({
      git_email: 'me@acme.test',
      git_editor: 'nano',
      git_sign: true,
      git_jobs: 4,
      // A list as a list: Ansible would give the role the text
      git_aliases: ['co', 'br'],
    })
  })

  test('says when no tool you install uses it yet, and saves it for later', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)

    const result = await cli.run(['vars', 'set', 'node_version', '22'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('node_version set to 22')
    expect(result.output).toContain(
      'No tool you install uses node_version yet: saved for later.',
    )
    expect(savedVariables(cli)).toEqual({ node_version: '22' })
  })

  test('refuses a value of another type, or not one of the choices', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)

    const jobs = await cli.run(['vars', 'set', 'git_jobs', '2.5'])
    const editor = await cli.run(['vars', 'set', 'git_editor', 'emacs'])

    expect(jobs.exitCode).toBe(1)
    expect(jobs.output).toContain('git_jobs: Type a whole number.')
    expect(editor.exitCode).toBe(1)
    expect(editor.output).toContain('git_editor: Use one of: vim, nano, code.')
  })

  test('refuses a variable no tool declares, a secret, and one the profile sets', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)
    cli.home.writeJson('volumes/tools/profile.json', {
      profile: 'acme/backend',
    })

    const unknown = await cli.run(['vars', 'set', 'nope', 'x'])
    const secret = await cli.run(['vars', 'set', 'git_token', 'x'])
    const profile = await cli.run(['vars', 'set', 'git_editor', 'vim'])

    expect(unknown.exitCode).toBe(1)
    expect(unknown.output).toContain('No tool of your sources declares nope')
    expect(secret.exitCode).toBe(1)
    expect(secret.output).toContain('git_token is a secret')
    expect(profile.exitCode).toBe(1)
    expect(profile.output).toContain('Backend sets git_editor: its value wins.')
    expect(cli.home.exists('volumes/tools/variables.json')).toBe(false)
  })

  test.skipIf(COMPILED)(
    'asks for the value without one: a select for choices, a yes/no for a bool, text else',
    async () => {
      await using cli = await createVarsCli()
      await sourceWithVariables(cli)

      const editor = await cli.run(['vars', 'set', 'git_editor'], {
        answers: [{ ask: 'git_editor', answer: 'nano' }],
      })
      const sign = await cli.run(['vars', 'set', 'git_sign'], {
        answers: [{ ask: 'git_sign', answer: true }],
      })
      const aliases = await cli.run(['vars', 'set', 'git_aliases'], {
        answers: [{ ask: 'git_aliases', answer: 'co, br' }],
      })

      expect([editor, sign, aliases].map(({ exitCode }) => exitCode)).toEqual([
        0, 0, 0,
      ])
      expect(savedVariables(cli)).toEqual({
        git_editor: 'nano',
        git_sign: true,
        git_aliases: ['co', 'br'],
      })
    },
  )

  test.skipIf(COMPILED)(
    'asks which variables without a name, then each value, and saves them at once',
    async () => {
      await using cli = await createVarsCli()
      await sourceWithVariables(cli)
      cli.home.seedPickedTools(['acme/git'])

      const result = await cli.run(['vars', 'set'], {
        answers: [
          { ask: 'Which variables?', answer: ['git_email', 'git_jobs'] },
          { ask: 'git_email', answer: 'me@acme.test' },
          { ask: 'git_jobs', answer: '4' },
        ],
      })

      expect(result.exitCode).toBe(0)
      expect(savedVariables(cli)).toEqual({
        git_email: 'me@acme.test',
        git_jobs: 4,
      })
      expect(result.output).toContain('The next `local-env install` uses them.')
    },
  )

  test('says what it takes without a value and no terminal', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)

    const result = await cli.run(['vars', 'set', 'git_editor'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(
      'Give a value for git_editor, one of: vim, nano, code',
    )
  })

  test('is also local-env variables', async () => {
    await using cli = await createVarsCli()
    await sourceWithVariables(cli)

    const result = await cli.run(['variables', 'set', 'git_email', 'a@b.c'])

    expect(result.exitCode).toBe(0)
    expect(savedVariables(cli)).toEqual({ git_email: 'a@b.c' })
  })
})

describe.concurrent('local-env vars unset', () => {
  test('removes a value, and keeps the others', async () => {
    await using cli = await createVarsCli()
    cli.home.writeJson('volumes/tools/variables.json', {
      git_email: 'me@acme.test',
      git_sign: true,
    })

    const result = await cli.run(['vars', 'unset', 'git_email'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('git_email removed')
    expect(savedVariables(cli)).toEqual({ git_sign: true })
  })

  test('says when there is no value to remove', async () => {
    await using cli = await createVarsCli()

    const result = await cli.run(['vars', 'unset', 'git_email'])

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('git_email has no value saved.')
  })
})
