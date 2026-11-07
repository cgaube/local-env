import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  isProfileChoice,
  applyVariablesChange,
  isVariablesChange,
  listGalaxyRoles,
  listRoles,
  readInstalled,
  readProfile,
  readSelection,
  readVariables,
  writeProfile,
  writeSelection,
  writeVariables,
} from '#services/dashboard/tools.js'

// A home's volumes/ folder: sources/<source>/ansible/<role>/ and tools/
const createVolumes = () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-env-tools-'))
  const sources = join(dir, 'sources')
  const tools = join(dir, 'tools')
  mkdirSync(tools, { recursive: true })
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(sources, path)), { recursive: true })
    writeFileSync(join(sources, path), content)
  }
  return { sources, tools, write }
}

describe('listRoles', () => {
  test('reads the name, description, tags and dependencies of meta/main.yml', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/node/tasks/main.yml', '- ping:\n')
    write(
      'acme/ansible/node/meta/main.yml',
      [
        'galaxy_info:',
        '  description: Node.js and npm, from Homebrew',
        '  galaxy_tags: [javascript, runtime]',
        'dependencies:',
        '  - homebrew',
        '  - role: git',
      ].join('\n'),
    )

    expect(listRoles(sources)).toEqual([
      {
        id: 'acme/node',
        source: 'acme',
        folder: 'node',
        name: 'node',
        collection: null,
        label: 'Node',
        description: 'Node.js and npm, from Homebrew',
        tags: ['javascript', 'runtime'],
        dependencies: ['homebrew', 'git'],
        dependencyVars: [{}, {}],
        isProfile: false,
        stacks: [],
        revision: expect.stringMatching(/^[0-9a-f]{12}$/),
        needsSudo: false,
        galaxy: {},
        inputs: [],
      },
    ])
  })

  test('reads the roles of a collection, named by its galaxy.yml', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/dev_tools/galaxy.yml',
      'namespace: acme\nname: dev_tools\nversion: 1.0.0\n',
    )
    write(
      'acme/ansible/dev_tools/meta/runtime.yml',
      "requires_ansible: '>=2.16'\n",
    )
    write('acme/ansible/dev_tools/roles/git_extras/tasks/main.yml', '- ping:\n')
    write(
      'acme/ansible/profiles/galaxy.yml',
      'namespace: acme\nname: profiles\n',
    )
    write(
      'acme/ansible/profiles/roles/backend/meta/main.yml',
      [
        'galaxy_info:',
        '  galaxy_tags: [profile]',
        'dependencies:',
        '  - acme.dev_tools.git_extras',
        '  - name: acme.dev_tools.jq',
      ].join('\n'),
    )
    write(
      'acme/ansible/profiles/roles/backend/local-env.yml',
      'label: Backend\nstacks: [mailpit]\n',
    )
    // A plain role beside the collections
    write('acme/ansible/node/tasks/main.yml', '- ping:\n')

    expect(
      listRoles(sources).map(
        ({ id, folder, name, collection, label, dependencies, stacks }) => ({
          id,
          folder,
          name,
          collection,
          label,
          dependencies,
          stacks,
        }),
      ),
    ).toEqual([
      {
        id: 'acme/acme.dev_tools.git_extras',
        folder: 'dev_tools/roles/git_extras',
        name: 'acme.dev_tools.git_extras',
        collection: 'acme.dev_tools',
        label: 'Git Extras',
        dependencies: [],
        stacks: [],
      },
      {
        id: 'acme/node',
        folder: 'node',
        name: 'node',
        collection: null,
        label: 'Node',
        dependencies: [],
        stacks: [],
      },
      {
        id: 'acme/acme.profiles.backend',
        folder: 'profiles/roles/backend',
        name: 'acme.profiles.backend',
        collection: 'acme.profiles',
        label: 'Backend',
        dependencies: ['acme.dev_tools.git_extras', 'acme.dev_tools.jq'],
        stacks: ['acme/mailpit'],
      },
    ])
  })

  test('keeps the Galaxy collections a collection needs, not those of a source', () => {
    const { sources, write } = createVolumes()
    write('team/ansible/tools/galaxy.yml', 'namespace: team\nname: tools\n')
    write('team/ansible/tools/roles/git/tasks/main.yml', '- ping:\n')
    write(
      'acme/ansible/profiles/galaxy.yml',
      [
        'namespace: acme',
        'name: profiles',
        'dependencies:',
        '  team.tools: "*"',
        '  geerlingguy.mac: ">=5.0.0,<6.0.0"',
        '  community.general: 8',
        '  bad: [1, 2]',
      ].join('\n'),
    )
    write('acme/ansible/profiles/roles/backend/tasks/main.yml', '- ping:\n')

    expect(
      listRoles(sources).map(({ name, galaxy }) => [name, galaxy]),
    ).toEqual([
      [
        'acme.profiles.backend',
        { 'geerlingguy.mac': '>=5.0.0,<6.0.0', 'community.general': '8' },
      ],
      ['team.tools.git', {}],
    ])
  })

  test('changes the revision when a range of galaxy.yml changes', () => {
    const { sources, write } = createVolumes()
    const galaxy = (range: string) =>
      write(
        'acme/ansible/tools/galaxy.yml',
        `namespace: acme\nname: tools\ndependencies:\n  geerlingguy.mac: "${range}"\n`,
      )
    write('acme/ansible/tools/roles/git/tasks/main.yml', '- ping:\n')
    galaxy('>=5.0.0')
    const [before] = listRoles(sources)

    galaxy('>=6.0.0')
    const [after] = listRoles(sources)

    expect(after?.revision).not.toBe(before?.revision)
  })

  test('leaves out a collection whose galaxy.yml has no valid name', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/tools/galaxy.yml', 'namespace: acme\nname: dev-tools\n')
    write('acme/ansible/tools/roles/git/tasks/main.yml', '- ping:\n')
    write('acme/ansible/broken/galaxy.yml', 'namespace: [unclosed\n')
    write('acme/ansible/broken/roles/git/tasks/main.yml', '- ping:\n')

    expect(listRoles(sources)).toEqual([])
  })

  test('is a profile when tagged profile', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/backend/meta/main.yml',
      'galaxy_info:\n  galaxy_tags: [profile]\ndependencies: [git]\n',
    )
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')

    expect(
      listRoles(sources).map(({ name, isProfile }) => [name, isProfile]),
    ).toEqual([
      ['backend', true],
      ['git', false],
    ])
  })

  test('reads the stacks of local-env.yml, in its source or another', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/backend/local-env.yml',
      [
        'stacks:',
        '  - postgres',
        '  - shared/mailpit',
        '  - acme/postgres',
        '  - ../../etc',
        '  - a/b/c',
        '  - 42',
      ].join('\n'),
    )
    write('acme/ansible/git/local-env.yml', 'stacks: [unclosed\n')

    expect(
      listRoles(sources).map(({ name, stacks }) => [name, stacks]),
    ).toEqual([
      ['backend', ['acme/postgres', 'shared/mailpit']],
      ['git', []],
    ])
  })

  test('lists a role without meta/main.yml, or with an invalid one', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')
    write('acme/ansible/jq/meta/main.yml', 'galaxy_info: [unclosed\n')

    expect(
      listRoles(sources).map(({ id, description, tags }) => ({
        id,
        description,
        tags,
      })),
    ).toEqual([
      { id: 'acme/git', description: null, tags: [] },
      { id: 'acme/jq', description: null, tags: [] },
    ])
  })

  test('lists the roles of every source, by source then name', () => {
    const { sources, write } = createVolumes()
    write('team/ansible/git/tasks/main.yml', '- ping:\n')
    write('acme/ansible/node/tasks/main.yml', '- ping:\n')
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')
    write('acme/docker/templates.json', '{}')

    expect(listRoles(sources).map(({ id }) => id)).toEqual([
      'acme/git',
      'acme/node',
      'team/git',
    ])
  })

  test('changes the revision when a file of the role changes', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')
    const [before] = listRoles(sources)

    write('acme/ansible/git/defaults/main.yml', 'version: 2\n')
    const [after] = listRoles(sources)

    expect(after?.revision).not.toBe(before?.revision)
  })

  test('needs sudo when a task becomes root', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/dns/tasks/main.yml',
      '- name: resolver\n  become: true\n  file: path=/etc/resolver state=directory\n',
    )
    write('acme/ansible/git/tasks/main.yml', '- ping:\n  become: false\n')

    expect(
      listRoles(sources).map(({ name, needsSudo }) => [name, needsSudo]),
    ).toEqual([
      ['dns', true],
      ['git', false],
    ])
  })
})

const ARGUMENT_SPECS = [
  'argument_specs:',
  '  main:',
  '    options:',
  '      git_email:',
  '        type: str',
  '        required: true',
  '        description: Your email, for commits',
  '      git_editor:',
  '        choices: [vim, nano, code]',
  '        default: vim',
  '        description:',
  '          - The editor git opens.',
  '          - For commit messages.',
  '      git_sign:',
  '        type: bool',
  '      git_token:',
  '        type: str',
  '        required: true',
  '        no_log: true',
  '      git_name:',
  '        required: true',
  '        default: null',
  '  other:',
  '    options:',
  '      ignored: {}',
  '',
].join('\n')

describe('role inputs', () => {
  test('reads the options of the main entry point of meta/argument_specs.yml', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')
    write('acme/ansible/git/meta/argument_specs.yml', ARGUMENT_SPECS)

    expect(listRoles(sources)[0]?.inputs).toEqual([
      {
        name: 'git_email',
        type: 'str',
        required: true,
        choices: null,
        description: 'Your email, for commits',
        secret: false,
      },
      {
        name: 'git_editor',
        type: 'str',
        required: false,
        default: 'vim',
        choices: ['vim', 'nano', 'code'],
        description: 'The editor git opens. For commit messages.',
        secret: false,
      },
      {
        name: 'git_sign',
        type: 'bool',
        required: false,
        choices: null,
        description: null,
        secret: false,
      },
      {
        name: 'git_token',
        type: 'str',
        required: true,
        choices: null,
        description: null,
        secret: true,
      },
      // A null default is none, as for Ansible
      {
        name: 'git_name',
        type: 'str',
        required: true,
        choices: null,
        description: null,
        secret: false,
      },
    ])
  })

  test('takes a value of defaults/main.yml as the default: not required then', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/git/meta/argument_specs.yml',
      'argument_specs:\n  main:\n    options:\n      git_email: { required: true }\n      git_name: { required: true }\n',
    )
    write('acme/ansible/git/defaults/main.yml', 'git_email: me@acme.test\n')

    expect(
      listRoles(sources)[0]?.inputs.map(
        ({ name, required, default: value }) => [name, required, value],
      ),
    ).toEqual([
      ['git_email', false, 'me@acme.test'],
      ['git_name', true, undefined],
    ])
  })

  test('reads the variables each dependency entry passes', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/backend/meta/main.yml',
      [
        'dependencies:',
        '  - git',
        '  - role: node',
        '    vars: { node_version: 22 }',
        '  # A role parameter, the older way',
        '  - role: zsh',
        '    zsh_theme: robby',
        '    when: true',
        '',
      ].join('\n'),
    )

    expect(listRoles(sources)[0]).toMatchObject({
      dependencies: ['git', 'node', 'zsh'],
      dependencyVars: [{}, { node_version: 22 }, { zsh_theme: 'robby' }],
    })
  })

  test('reads argument_specs of meta/main.yml without a file of its own', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/git/meta/main.yml',
      'argument_specs:\n  main:\n    options:\n      git_email: { required: true }\n',
    )

    expect(listRoles(sources)[0]?.inputs.map(({ name }) => name)).toEqual([
      'git_email',
    ])
  })

  test('has no inputs without the file, or with an invalid one', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')
    write('acme/ansible/node/meta/argument_specs.yml', 'argument_specs: [\n')
    write(
      'acme/ansible/jq/meta/argument_specs.yml',
      'argument_specs:\n  main:\n    options: [a, b]\n',
    )
    write(
      'acme/ansible/ruby/meta/argument_specs.yml',
      // Not a name Ansible accepts, and not an option
      'argument_specs:\n  main:\n    options:\n      "1x": {}\n      ok: 3\n',
    )

    expect(
      listRoles(sources).map(({ name, inputs }) => [name, inputs]),
    ).toEqual([
      ['git', []],
      ['jq', []],
      ['node', []],
      ['ruby', []],
    ])
  })

  test('changes the revision when the spec changes', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/git/meta/argument_specs.yml', ARGUMENT_SPECS)
    const before = listRoles(sources)[0]?.revision

    write('acme/ansible/git/meta/argument_specs.yml', 'argument_specs: {}\n')

    expect(listRoles(sources)[0]?.revision).not.toBe(before)
  })

  test('reads the inputs and dependencies of the installed Galaxy roles', () => {
    const { tools } = createVolumes()
    const mac = join(tools, 'collections/ansible_collections/geerlingguy/mac')
    mkdirSync(join(mac, 'roles/dock/meta'), { recursive: true })
    mkdirSync(join(mac, 'roles/homebrew'), { recursive: true })
    writeFileSync(
      join(mac, 'roles/dock/meta/main.yml'),
      'dependencies: [homebrew, community.general.x]\n',
    )
    writeFileSync(
      join(mac, 'roles/dock/meta/argument_specs.yml'),
      'argument_specs:\n  main:\n    options:\n      dockitems_remove: { type: list, default: [] }\n',
    )

    expect(listGalaxyRoles(join(tools, 'collections'))).toEqual([
      {
        name: 'geerlingguy.mac.dock',
        dependencies: ['geerlingguy.mac.homebrew', 'community.general.x'],
        dependencyVars: [{}, {}],
        inputs: [
          {
            name: 'dockitems_remove',
            type: 'list',
            required: false,
            default: [],
            choices: null,
            description: null,
            secret: false,
          },
        ],
      },
      {
        name: 'geerlingguy.mac.homebrew',
        dependencies: [],
        dependencyVars: [],
        inputs: [],
      },
    ])
    expect(listGalaxyRoles(join(tools, 'none'))).toEqual([])
  })
})

describe('the variables', () => {
  test('are saved by name, in order', () => {
    const { tools } = createVolumes()

    writeVariables(tools, { git_email: 'me@acme.test', git_editor: 'vim' })

    expect(readFileSync(join(tools, 'variables.json'), 'utf8')).toBe(
      '{\n  "git_editor": "vim",\n  "git_email": "me@acme.test"\n}\n',
    )
    expect(readVariables(tools)).toEqual({
      git_editor: 'vim',
      git_email: 'me@acme.test',
    })
  })

  test('are none without a file, and leave out bad names and nulls', () => {
    const { tools } = createVolumes()
    expect(readVariables(tools)).toEqual({})

    writeFileSync(
      join(tools, 'variables.json'),
      '{ "ok": 1, "no-dash": 2, "gone": null }',
    )

    expect(readVariables(tools)).toEqual({ ok: 1 })
  })

  test('change by name: a value of an input of the roles, of its type, never a secret', () => {
    const { sources, write } = createVolumes()
    write('acme/ansible/git/meta/argument_specs.yml', ARGUMENT_SPECS)
    const roles = listRoles(sources)
    const galaxy = [
      {
        name: 'geerlingguy.mac.dock',
        dependencies: [],
        inputs: [
          {
            name: 'dock_items',
            type: 'list',
            required: false,
            choices: null,
            description: null,
            secret: false,
          },
        ],
      },
    ]
    const check = (value: unknown, saved = {}) =>
      isVariablesChange(roles, galaxy, saved, value)

    expect(check({ git_email: 'me@acme.test', git_sign: true })).toBe(true)
    expect(check({ git_editor: 'nano' })).toBe(true)
    expect(check({})).toBe(true)
    expect(check({ git_editor: 'emacs' })).toBe(false)
    expect(check({ git_sign: 'yes' })).toBe(false)
    expect(check({ git_token: 'secret' })).toBe(false)
    expect(check({ unknown: 'x' })).toBe(false)
    // Kept as it was: its role left the sources
    expect(check({ gone: 'x' }, { gone: 'x' })).toBe(true)
    expect(check({ gone: 'y' }, { gone: 'x' })).toBe(false)
    // No role includes this Galaxy role
    expect(check({ dock_items: ['a', 'b'] })).toBe(false)
    expect(check(['git_email'])).toBe(false)
    // null removes it, a secret too
    expect(check({ git_token: null, gone: null })).toBe(true)
    expect(check({ 'no-dash': null })).toBe(false)
  })

  test('change only the names they name: the others stay', () => {
    expect(
      applyVariablesChange(
        { git_email: 'me@acme.test', git_editor: 'vim', other: 1 },
        { git_editor: 'nano', other: null, git_sign: true },
      ),
    ).toEqual({ git_email: 'me@acme.test', git_editor: 'nano', git_sign: true })
  })
})

describe('the profile', () => {
  test('is saved by id, or as none', () => {
    const { tools } = createVolumes()

    writeProfile(tools, 'acme/backend')
    expect(readProfile(tools)).toBe('acme/backend')

    writeProfile(tools, null)
    expect(readProfile(tools)).toBeNull()
  })

  test('can be chosen among the profiles of the catalog, or none', () => {
    const { sources, write } = createVolumes()
    write(
      'acme/ansible/backend/meta/main.yml',
      'galaxy_info:\n  galaxy_tags: [profile]\n',
    )
    write('acme/ansible/git/tasks/main.yml', '- ping:\n')
    const roles = listRoles(sources)

    expect(isProfileChoice(roles, 'acme/backend')).toBe(true)
    expect(isProfileChoice(roles, null)).toBe(true)
    // A tool, a profile of no source, not an id
    expect(isProfileChoice(roles, 'acme/git')).toBe(false)
    expect(isProfileChoice(roles, 'team/backend')).toBe(false)
    expect(isProfileChoice(roles, ['acme/backend'])).toBe(false)
    expect(isProfileChoice(roles, undefined)).toBe(false)
  })

  test('is none without a file, or with an id that names no role', () => {
    const { tools } = createVolumes()
    expect(readProfile(tools)).toBeNull()

    writeFileSync(join(tools, 'profile.json'), '{ "profile": "../etc" }')
    expect(readProfile(tools)).toBeNull()
  })
})

describe('the selection', () => {
  test('is saved in picked.json, by id', () => {
    const { tools } = createVolumes()

    writeSelection(tools, ['acme/git', 'team/team.tools.node', 'acme/git'])

    expect(
      JSON.parse(readFileSync(join(tools, 'picked.json'), 'utf8')),
    ).toEqual({ picked: ['acme/git', 'team/team.tools.node'] })
    // A pick gone from the sources stays, to unpick it
    expect(readSelection(tools)).toEqual(['acme/git', 'team/team.tools.node'])
  })

  test('leaves out what is no id', () => {
    const { tools } = createVolumes()
    writeFileSync(
      join(tools, 'picked.json'),
      JSON.stringify({
        picked: ['acme/git', '../etc', 'git', 42, null],
      }),
    )

    expect(readSelection(tools)).toEqual(['acme/git'])
  })

  test('is empty without a file', () => {
    const { tools } = createVolumes()

    expect(readSelection(tools)).toEqual([])
    expect(readInstalled(tools)).toEqual({})
  })
})
