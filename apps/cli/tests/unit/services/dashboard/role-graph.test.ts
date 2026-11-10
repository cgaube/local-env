import {
  externalRoles,
  type GraphRole,
  includedRoles,
  inputText,
  isInputValue,
  missingInputs,
  parseInputText,
  playbookRoots,
  type RoleInput,
  passedValues,
  roleValues,
  unsupportedSecrets,
  valuesChanged,
  wantedInputs,
  wantedRoles,
  wantedStacks,
} from '#services/dashboard/role-graph.js'

const input = (
  name: string,
  overrides: Partial<RoleInput> = {},
): RoleInput => ({
  name,
  type: 'str',
  required: false,
  choices: null,
  description: null,
  secret: false,
  ...overrides,
})

const role = (
  id: string,
  {
    dependencies = [],
    stacks = [],
    galaxy = {},
    inputs = [],
    dependencyVars,
    secrets,
  }: Partial<GraphRole> = {},
): GraphRole => {
  // <source>/<role>, or <source>/<namespace>.<collection>.<role>
  const name = id.split('/')[1] ?? id
  const parts = name.split('.')
  return {
    id,
    name,
    collection: parts.length === 3 ? parts.slice(0, 2).join('.') : null,
    label: parts.at(-1) ?? name,
    dependencies,
    stacks,
    galaxy,
    inputs,
    ...(dependencyVars ? { dependencyVars } : {}),
    ...(secrets ? { secrets } : {}),
  }
}

describe('includedRoles', () => {
  test('finds the roles of collections by their full name, in any source', () => {
    const roles = [
      role('acme/acme.profiles.backend', {
        dependencies: ['acme.tools.git', 'shared.db.postgres'],
      }),
      role('acme/acme.tools.git'),
      role('team/shared.db.postgres'),
    ]

    expect(
      Object.fromEntries(includedRoles(roles, ['acme/acme.profiles.backend'])),
    ).toEqual({
      'acme/acme.tools.git': ['backend'],
      'team/shared.db.postgres': ['backend'],
    })
  })

  test('finds a role of the same collection by its short name first', () => {
    const roles = [
      role('acme/acme.tools.node', { dependencies: ['git'] }),
      role('acme/acme.tools.git'),
      role('acme/git'),
      role('acme/acme.tools.jq', { dependencies: ['curl'] }),
      role('acme/curl'),
    ]

    expect([...wantedRoles(roles, ['acme/acme.tools.node'])]).toEqual([
      'acme/acme.tools.node',
      'acme/acme.tools.git',
    ])
    // Not in its collection: a plain role of that name
    expect([...wantedRoles(roles, ['acme/acme.tools.jq'])]).toEqual([
      'acme/acme.tools.jq',
      'acme/curl',
    ])
  })

  test('follows a profile that depends on another profile', () => {
    const roles = [
      role('acme/backend', { dependencies: ['base', 'node'] }),
      role('acme/base', { dependencies: ['git'] }),
      role('acme/git'),
      role('acme/node'),
    ]

    expect(Object.fromEntries(includedRoles(roles, ['acme/backend']))).toEqual({
      'acme/base': ['backend'],
      'acme/git': ['backend'],
      'acme/node': ['backend'],
    })
  })

  test('finds a dependency by name in any source', () => {
    const roles = [
      role('acme/backend', { dependencies: ['git'] }),
      role('team/git'),
    ]

    expect([...includedRoles(roles, ['acme/backend']).keys()]).toEqual([
      'team/git',
    ])
  })

  test('names every root that includes a role', () => {
    const roles = [
      role('acme/backend', { dependencies: ['git'] }),
      role('acme/node', { dependencies: ['git'] }),
      role('acme/git'),
    ]

    expect(
      includedRoles(roles, ['acme/backend', 'acme/node']).get('acme/git'),
    ).toEqual(['backend', 'node'])
  })

  test('stops on a cycle, without including the root in itself', () => {
    const roles = [
      role('acme/a', { dependencies: ['b'] }),
      role('acme/b', { dependencies: ['a'] }),
    ]

    expect(Object.fromEntries(includedRoles(roles, ['acme/a']))).toEqual({
      'acme/b': ['a'],
    })
  })
})

describe('wantedRoles', () => {
  test('is the roots and what they include, without unknown roots', () => {
    const roles = [
      role('acme/backend', { dependencies: ['git'] }),
      role('acme/git'),
    ]

    expect(wantedRoles(roles, ['acme/backend', 'gone/role'])).toEqual(
      new Set(['acme/backend', 'acme/git']),
    )
  })
})

describe('wantedStacks', () => {
  test('lists the stacks of every wanted role once, with the first role that needs it', () => {
    const roles = [
      role('acme/backend', {
        dependencies: ['postgres-client'],
        stacks: ['acme/mailpit'],
      }),
      role('acme/postgres-client', {
        stacks: ['acme/postgres', 'acme/mailpit'],
      }),
      role('acme/other', { stacks: ['acme/redis'] }),
    ]

    expect(wantedStacks(roles, ['acme/backend'])).toEqual([
      { stack: 'acme/mailpit', by: 'acme/backend' },
      { stack: 'acme/postgres', by: 'acme/postgres-client' },
    ])
  })
})

describe('playbookRoots', () => {
  test('drops the roots another root includes, wherever they are', () => {
    const roles = [
      role('acme/backend', { dependencies: ['base'] }),
      role('acme/base', { dependencies: ['git'] }),
      role('acme/git'),
      role('acme/jq'),
    ]

    expect(
      playbookRoots(roles, [
        'acme/git',
        'acme/backend',
        'acme/jq',
        'acme/base',
      ]),
    ).toEqual(['acme/backend', 'acme/jq'])
  })

  test('keeps one of two roots that include each other', () => {
    const roles = [
      role('acme/a', { dependencies: ['b'] }),
      role('acme/b', { dependencies: ['a'] }),
    ]

    expect(playbookRoots(roles, ['acme/a', 'acme/b'])).toEqual(['acme/b'])
  })
})

describe('externalRoles', () => {
  test('names the roles no source has: from Galaxy, or missing', () => {
    const roles = [
      role('acme/acme.profiles.backend', {
        dependencies: [
          'acme.tools.git',
          'geerlingguy.mac.dock',
          'geerlingguy.mac.dock',
          'acme.gone.jq',
        ],
        galaxy: { 'geerlingguy.mac': '>=5.0.0' },
      }),
      role('acme/acme.tools.git', {
        // Its collection doesn't ask for geerlingguy.mac
        dependencies: ['geerlingguy.mac.mas', 'curl'],
      }),
    ]

    expect(externalRoles(roles, ['acme/acme.profiles.backend'])).toEqual([
      {
        name: 'geerlingguy.mac.dock',
        collection: 'geerlingguy.mac',
        kind: 'galaxy',
        by: 'acme/acme.profiles.backend',
      },
      {
        name: 'acme.gone.jq',
        collection: null,
        kind: 'missing',
        by: 'acme/acme.profiles.backend',
      },
      {
        name: 'geerlingguy.mac.mas',
        collection: null,
        kind: 'missing',
        by: 'acme/acme.tools.git',
      },
      // A short name is a role of its own collection
      {
        name: 'acme.tools.curl',
        collection: null,
        kind: 'missing',
        by: 'acme/acme.tools.git',
      },
    ])
  })
})

describe('wantedInputs', () => {
  const email = input('git_email', { required: true })
  const roles = [
    role('acme/backend', {
      dependencies: ['git', 'geerlingguy.mac.dock'],
      galaxy: { 'geerlingguy.mac': '*' },
    }),
    role('acme/git', {
      inputs: [email, input('editor', { default: 'vim', choices: ['vim'] })],
    }),
    role('acme/node', {
      inputs: [
        input('git_email', { description: 'For npm' }),
        input('token', { required: true, secret: true }),
      ],
    }),
    role('acme/zsh', { inputs: [input('editor', { required: true })] }),
  ]
  const galaxy = [
    {
      name: 'geerlingguy.mac.dock',
      dependencies: ['geerlingguy.mac.homebrew'],
      inputs: [input('dock_items', { type: 'list' })],
    },
    {
      name: 'geerlingguy.mac.homebrew',
      dependencies: [],
      inputs: [input('git_email')],
    },
  ]

  test('lists the inputs of the wanted roles and the Galaxy roles they include', () => {
    expect(wantedInputs(roles, ['acme/backend'], galaxy)).toEqual([
      {
        ...email,
        roles: ['git', 'geerlingguy.mac.homebrew'],
        setBy: [],
        provided: false,
        vault: false,
        conflict: false,
      },
      {
        ...input('editor', { default: 'vim', choices: ['vim'] }),
        roles: ['git'],
        setBy: [],
        provided: false,
        vault: false,
        conflict: false,
      },
      {
        ...input('dock_items', { type: 'list' }),
        roles: ['geerlingguy.mac.dock'],
        setBy: [],
        provided: false,
        vault: false,
        conflict: false,
      },
    ])
  })

  test('needs no value from the user for an input that the role including it passes', () => {
    const child = role('acme/child', {
      inputs: [input('child_name', { required: true })],
    })
    const parent = role('acme/parent', {
      dependencies: ['child', 'geerlingguy.mac.dock'],
      dependencyVars: [{ child_name: 'from-parent' }, { dock_items: [] }],
      galaxy: { 'geerlingguy.mac': '*' },
    })
    const graph = [child, parent]

    const inputs = wantedInputs(graph, ['acme/parent'], galaxy)

    expect(
      inputs.map(({ name, required, setBy, provided }) => [
        name,
        required,
        setBy,
        provided,
      ]),
    ).toEqual([
      ['child_name', false, ['parent'], true],
      ['dock_items', false, ['parent'], true],
      // homebrew, under dock: dock does not pass it
      ['git_email', false, [], false],
    ])
    // The value it gives, as written
    expect(inputs[0]?.given).toBe('from-parent')
    expect(missingInputs(inputs, {})).toEqual([])
    // A saved value is not passed: the parent's stays
    expect(passedValues(inputs, { child_name: 'me', git_email: 'a' })).toEqual({
      git_email: 'a',
    })
  })

  test("keeps the parent's value when the role is picked too: it runs inside the parent", () => {
    const child = role('acme/child', {
      inputs: [input('child_name', { required: true })],
    })
    const parent = role('acme/parent', {
      dependencies: ['child'],
      dependencyVars: [{ child_name: 'from-parent' }],
    })

    // The playbook names only the parent: the pick runs inside it
    const [childName] = wantedInputs(
      [child, parent],
      ['acme/parent', 'acme/child'],
    )

    expect(childName).toMatchObject({
      required: false,
      setBy: ['parent'],
      provided: true,
      given: 'from-parent',
    })
    expect(passedValues([childName!], { child_name: 'me' })).toEqual({})
  })

  test("keeps the parent's value when another role includes it without one", () => {
    const child = role('acme/child', {
      inputs: [input('child_name', { required: true })],
    })
    const parent = role('acme/parent', {
      dependencies: ['child'],
      dependencyVars: [{ child_name: 'from-parent' }],
    })
    const other = role('acme/other', { dependencies: ['child'] })

    const [childName] = wantedInputs(
      [child, parent, other],
      ['acme/parent', 'acme/other'],
    )

    // Its owner chose it: it wins over the user's
    expect(childName).toMatchObject({ provided: true, required: false })
  })

  test('says when two roles declare a name differently', () => {
    const inputs = wantedInputs(
      [
        role('acme/git', { inputs: [input('editor', { choices: ['vim'] })] }),
        role('acme/zsh', { inputs: [input('editor', { type: 'list' })] }),
        role('acme/node', { inputs: [input('jobs', { type: 'int' })] }),
        role('acme/ruby', { inputs: [input('jobs', { type: 'int' })] }),
      ],
      ['acme/git', 'acme/zsh', 'acme/node', 'acme/ruby'],
    )

    expect(inputs.map(({ name, conflict }) => [name, conflict])).toEqual([
      ['editor', true],
      ['jobs', false],
    ])
  })

  test('merges a name two roles declare: required or secret when one is', () => {
    const inputs = wantedInputs(roles, ['acme/git', 'acme/node', 'acme/zsh'])

    expect(
      inputs.map(({ name, required, roles }) => [name, required, roles]),
    ).toEqual([
      ['git_email', true, ['git', 'node']],
      ['editor', true, ['git', 'zsh']],
      ['token', true, ['node']],
    ])
    // The first declaration describes it
    expect(inputs[0]?.description).toBeNull()
    expect(inputs[1]?.default).toBe('vim')
    expect(
      missingInputs(inputs, { editor: 'nano' }).map(({ name }) => name),
    ).toEqual(['git_email'])
    expect(unsupportedSecrets(inputs).map(({ name }) => name)).toEqual([
      'token',
    ])
  })

  test('takes from the vault what the source of a wanted role gives, for every role that declares it', () => {
    const withVault = [
      role('acme/git', { inputs: [email], secrets: ['git_email'] }),
      role('acme/node', {
        inputs: [
          input('git_email'),
          input('token', { required: true, secret: true }),
        ],
        secrets: ['token'],
      }),
    ]
    const inputs = wantedInputs(withVault, ['acme/git', 'acme/node'])

    expect(inputs.map(({ name, vault }) => [name, vault])).toEqual([
      ['git_email', true],
      ['token', true],
    ])
    // Never asked, passed or unsupported: local-env reads it
    expect(missingInputs(inputs, {})).toEqual([])
    expect(unsupportedSecrets(inputs)).toEqual([])
    expect(passedValues(inputs, { git_email: 'me@acme.com' })).toEqual({})
    // Only what a wanted role's source gives
    expect(
      wantedInputs(withVault, ['acme/node']).map(({ name, vault }) => [
        name,
        vault,
      ]),
    ).toEqual([
      ['git_email', false],
      ['token', true],
    ])
  })

  test('keeps the value a role including it passes over the vault', () => {
    const inputs = wantedInputs(
      [
        role('acme/backend', {
          dependencies: ['git'],
          dependencyVars: [{ git_email: 'team@acme.com' }],
        }),
        role('acme/git', { inputs: [email], secrets: ['git_email'] }),
      ],
      ['acme/backend'],
    )

    expect(inputs[0]).toMatchObject({ provided: true, vault: false })
  })
})

describe('isInputValue', () => {
  test('wants a value of its type, or of its choices', () => {
    expect(isInputValue(input('a'), 'x')).toBe(true)
    expect(isInputValue(input('a'), 3)).toBe(false)
    expect(isInputValue(input('a', { type: 'int' }), 3)).toBe(true)
    expect(isInputValue(input('a', { type: 'int' }), 3.5)).toBe(false)
    expect(isInputValue(input('a', { type: 'float' }), 3.5)).toBe(true)
    expect(isInputValue(input('a', { type: 'bool' }), false)).toBe(true)
    // Ansible checks that the text can be a list, but the role gets the text
    expect(isInputValue(input('a', { type: 'list' }), 'a,b')).toBe(false)
    expect(isInputValue(input('a', { type: 'list' }), ['a', 'b'])).toBe(true)
    expect(isInputValue(input('a', { type: 'dict' }), { a: 1 })).toBe(true)
    expect(isInputValue(input('a', { type: 'dict' }), [1])).toBe(false)
    expect(isInputValue(input('a', { choices: [1, 2] }), 2)).toBe(true)
    expect(isInputValue(input('a', { choices: [1, 2] }), '2')).toBe(false)
    expect(isInputValue(input('a', { type: 'raw' }), null)).toBe(false)
  })
})

describe('roleValues', () => {
  test('are the saved values of its own inputs, without secrets, by name', () => {
    const git = role('acme/git', {
      inputs: [
        input('b'),
        input('a'),
        input('s', { secret: true }),
        input('c'),
      ],
    })

    expect(roleValues(git, { b: 2, a: 1, s: 'x', other: 3 })).toEqual({
      a: 1,
      b: 2,
    })
    expect(valuesChanged(git, { a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false)
    expect(valuesChanged(git, { a: 1, b: 3 }, { b: 2, a: 1 })).toBe(true)
    expect(valuesChanged(git, {}, undefined)).toBe(false)
    expect(valuesChanged(git, { other: 1 }, undefined)).toBe(false)
  })
})

describe('parseInputText', () => {
  test('turns the text of a field into a value of the input type', () => {
    expect(parseInputText(input('a'), 'x')).toEqual({ value: 'x' })
    expect(parseInputText(input('a'), '  ')).toEqual({ value: undefined })
    expect(parseInputText(input('a', { type: 'int' }), '8')).toEqual({
      value: 8,
    })
    expect(parseInputText(input('a', { type: 'int' }), '8.5')).toEqual({
      error: 'Type a whole number.',
    })
    expect(parseInputText(input('a', { type: 'float' }), '8.5')).toEqual({
      value: 8.5,
    })
    expect(parseInputText(input('a', { type: 'list' }), 'Ana, Bo,')).toEqual({
      value: ['Ana', 'Bo'],
    })
    expect(parseInputText(input('a', { type: 'dict' }), '{"a": 1}')).toEqual({
      value: { a: 1 },
    })
    expect(parseInputText(input('a', { type: 'dict' }), 'a=1')).toEqual({
      error: 'Type a JSON object: {"key": "value"}.',
    })
  })

  test('shows a list as text it reads back, a dict as JSON', () => {
    const list = input('a', { type: 'list' })
    expect(inputText(list, ['Ana', 'Bo'])).toBe('Ana, Bo')
    expect(parseInputText(list, inputText(list, ['Ana', 'Bo']))).toEqual({
      value: ['Ana', 'Bo'],
    })
    expect(inputText(input('a', { type: 'dict' }), { a: 1 })).toBe('{"a":1}')
    expect(inputText(input('a'), undefined)).toBe('')
  })
})
