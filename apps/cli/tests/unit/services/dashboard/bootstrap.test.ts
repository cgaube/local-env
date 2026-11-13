import {
  bootstrapStatuses,
  planBootstrap,
} from '#services/dashboard/bootstrap.js'
import type { Role } from '#services/dashboard/tools.js'

// A role of the source acme, with what the bootstrap reads of it
const role = (name: string, overrides: Partial<Role> = {}): Role =>
  ({
    id: `acme/${name}`,
    name,
    collection: null,
    label: name,
    source: 'acme',
    folder: name,
    dependencies: [],
    stacks: [],
    inputs: [],
    secrets: [],
    logins: [],
    revision: 'r1',
    ...overrides,
  }) as Role

const input = (name: string, secret = false) => ({
  name,
  type: 'str',
  required: true,
  choices: null,
  description: null,
  secret,
})

describe('planBootstrap', () => {
  const granted = role('granted', {
    dependencies: ['aws_cli'],
    inputs: [input('aws_role_name'), input('token', true)],
  })
  const catalog = [granted, role('aws_cli'), role('git')]

  test('runs the listed roles and what they include', () => {
    const plan = planBootstrap(catalog, 'acme', ['granted'])!

    expect(plan.run.map(({ id }) => id)).toEqual([
      'acme/granted',
      'acme/aws_cli',
    ])
    expect(plan.problems).toEqual([])
  })

  test('changes its revision with a role of the run or a value of an input, not a secret or another role', () => {
    const base = planBootstrap(catalog, 'acme', ['granted'], {
      aws_role_name: 'Dev',
    })!.revision
    const revision = (
      roles: Role[],
      values: Record<string, unknown> = { aws_role_name: 'Dev' },
    ) => planBootstrap(roles, 'acme', ['granted'], values)!.revision

    expect(revision(catalog)).toBe(base)
    expect(revision(catalog, { aws_role_name: 'Admin' })).not.toBe(base)
    expect(
      revision(catalog, { aws_role_name: 'Dev', token: 'x', other: 1 }),
    ).toBe(base)
    expect(
      revision([granted, role('aws_cli', { revision: 'r2' }), role('git')]),
    ).not.toBe(base)
    expect(
      revision([granted, role('aws_cli'), role('git', { revision: 'r2' })]),
    ).toBe(base)
  })

  test('is null without roles', () => {
    expect(planBootstrap(catalog, 'acme', [])).toBeNull()
  })
})

describe('bootstrapStatuses', () => {
  const catalog = [role('granted')]
  const plan = planBootstrap(catalog, 'acme', ['granted'])!

  test.each([
    [{}, 'never'],
    [{ acme: { revision: plan.revision, ranAt: '' } }, 'done'],
    [{ acme: { revision: 'old', ranAt: '' } }, 'changed'],
  ] as const)('with %j, is %s', (state, expected) => {
    expect(bootstrapStatuses([plan], state)[0]?.state).toBe(expected)
  })

  test('is blocked when it cannot run', () => {
    const blocked = planBootstrap(
      [role('granted', { logins: ['acme-dev'] })],
      'acme',
      ['granted'],
    )!

    expect(bootstrapStatuses([blocked], {})[0]).toMatchObject({
      state: 'blocked',
      problems: [expect.stringContaining('names logins (acme-dev)')],
    })
  })
})
