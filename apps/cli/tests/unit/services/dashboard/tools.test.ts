import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  isProfileChoice,
  listRoles,
  readInstalled,
  readProfile,
  readSelection,
  writeProfile,
  writeSelection,
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
        name: 'node',
        description: 'Node.js and npm, from Homebrew',
        tags: ['javascript', 'runtime'],
        dependencies: ['homebrew', 'git'],
        isProfile: false,
        stacks: [],
        revision: expect.stringMatching(/^[0-9a-f]{12}$/),
        needsSudo: false,
      },
    ])
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
  test('is a playbook of the picked roles, read back by id', () => {
    const { tools } = createVolumes()

    writeSelection(tools, ['acme/git', 'team/node'])

    expect(readFileSync(join(tools, 'playbook.yml'), 'utf8')).toContain(
      [
        '  roles:',
        '    - role: ../sources/acme/ansible/git',
        '    - role: ../sources/team/ansible/node',
      ].join('\n'),
    )
    expect(readSelection(tools)).toEqual(['acme/git', 'team/node'])
  })

  test('is a valid playbook with nothing picked', () => {
    const { tools } = createVolumes()

    writeSelection(tools, [])

    expect(
      Bun.YAML.parse(readFileSync(join(tools, 'playbook.yml'), 'utf8')),
    ).toEqual([
      {
        name: 'local-env tools',
        hosts: 'localhost',
        connection: 'local',
        roles: [],
      },
    ])
    expect(readSelection(tools)).toEqual([])
  })

  test('leaves out roles that are not in a source', () => {
    const { tools } = createVolumes()
    writeFileSync(
      join(tools, 'playbook.yml'),
      [
        '- hosts: localhost',
        '  roles:',
        '    - ../sources/acme/ansible/git',
        '    - geerlingguy.docker',
        '    - role: /etc/roles/evil',
      ].join('\n'),
    )

    expect(readSelection(tools)).toEqual(['acme/git'])
  })

  test('is empty without a playbook', () => {
    const { tools } = createVolumes()

    expect(readSelection(tools)).toEqual([])
    expect(readInstalled(tools)).toEqual({})
  })
})
