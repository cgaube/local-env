import {
  type GraphRole,
  includedRoles,
  playbookRoots,
  wantedRoles,
  wantedStacks,
} from '#services/dashboard/role-graph.js'

const role = (
  id: string,
  { dependencies = [], stacks = [] }: Partial<GraphRole> = {},
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
