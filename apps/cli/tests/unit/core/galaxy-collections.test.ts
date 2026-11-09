import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Role } from '#services/dashboard/tools.js'
import {
  GALAXY_DIR,
  galaxyRequirements,
  galaxyResults,
  galaxyRolesNeedingSudo,
  requirementsOf,
} from '#cli/core/galaxy-collections.js'

const role = (overrides: Partial<Role>): Role => ({
  id: 'acme/acme.tools.git',
  source: 'acme',
  folder: 'tools/roles/git',
  name: 'acme.tools.git',
  collection: 'acme.tools',
  label: 'Git',
  description: null,
  tags: [],
  dependencies: [],
  isProfile: false,
  stacks: [],
  revision: 'a1b2c3d4e5f6',
  needsSudo: false,
  galaxy: {},
  inputs: [],
  logins: [],
  secrets: {},
  ...overrides,
})

describe('galaxyRequirements', () => {
  test('gathers the ranges of every collection, with what asked for each', () => {
    const requirements = galaxyRequirements([
      role({
        galaxy: {
          'geerlingguy.mac': '>=5.0.0,<6.0.0',
          'community.general': '*',
        },
      }),
      // Another role of the same collection: asked once
      role({
        id: 'acme/acme.tools.jq',
        folder: 'tools/roles/jq',
        galaxy: {
          'geerlingguy.mac': '>=5.0.0,<6.0.0',
          'community.general': '*',
        },
      }),
      role({
        id: 'team/team.editors.code',
        source: 'team',
        folder: 'editors/roles/code',
        collection: 'team.editors',
        galaxy: { 'geerlingguy.mac': '>=5.1.0' },
      }),
      // A plain role has no galaxy.yml
      role({ collection: null, folder: 'node', galaxy: {} }),
    ])

    expect(requirements).toEqual([
      {
        name: 'geerlingguy.mac',
        versions: ['>=5.0.0,<6.0.0', '>=5.1.0'],
        askedBy: [
          'acme/ansible/tools/galaxy.yml',
          'team/ansible/editors/galaxy.yml',
        ],
      },
      {
        name: 'community.general',
        versions: ['*'],
        askedBy: ['acme/ansible/tools/galaxy.yml'],
      },
    ])
    // One entry per range, so the resolver meets them all; none for `*`
    expect(Bun.YAML.parse(requirementsOf(requirements))).toEqual({
      collections: [
        { name: 'geerlingguy.mac', version: '>=5.0.0,<6.0.0' },
        { name: 'geerlingguy.mac', version: '>=5.1.0' },
        { name: 'community.general' },
      ],
    })
  })
})

describe('galaxyRolesNeedingSudo', () => {
  const write = (path: string, content: string) => {
    const file = join(GALAXY_DIR, 'ansible_collections', path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }

  test('reads the installed Galaxy roles, and the ones they include', () => {
    rmSync(GALAXY_DIR, { recursive: true, force: true })
    write(
      'geerlingguy/mac/roles/dock/meta/main.yml',
      'dependencies: [homebrew]\n',
    )
    write('geerlingguy/mac/roles/dock/tasks/main.yml', '- ping:\n')
    write(
      'geerlingguy/mac/roles/homebrew/tasks/main.yml',
      '- name: Prepare\n  become: true\n  ping:\n',
    )

    expect(
      galaxyRolesNeedingSudo([
        {
          name: 'geerlingguy.mac.dock',
          collection: 'geerlingguy.mac',
          kind: 'galaxy',
          by: 'acme/acme.profiles.backend',
        },
        // Not installed: Ansible stops on it, not on sudo
        {
          name: 'acme.gone.role',
          collection: null,
          kind: 'missing',
          by: 'acme/acme.profiles.backend',
        },
      ]),
    ).toEqual(['geerlingguy.mac.homebrew'])
  })
})

describe('galaxyResults', () => {
  const asked = [
    { name: 'geerlingguy.mac', versions: ['>=5.0.0'], askedBy: [] },
    { name: 'community.general', versions: ['*'], askedBy: [] },
  ]

  test('reads what ansible-galaxy installed and what was there', () => {
    // Its own words (ansible-core 2.21)
    const output = [
      'Starting galaxy collection install process',
      'Process install dependency map',
      'Starting collection install process',
      "Installing 'geerlingguy.mac:5.0.0' to '/tmp/ansible_collections/geerlingguy/mac'",
      'geerlingguy.mac:5.0.0 was installed successfully',
      "'community.general:13.2.0' is already installed, skipping.",
      'community.library_inventory_filtering_v1:1.1.5 was installed successfully',
    ]

    expect(galaxyResults(asked, output)).toEqual([
      { name: 'geerlingguy.mac', version: '5.0.0', installed: true },
      { name: 'community.general', version: '13.2.0', installed: false },
      // Brought by those
      {
        name: 'community.library_inventory_filtering_v1',
        version: '1.1.5',
        installed: true,
      },
    ])
  })

  test('has every collection there already when there is nothing to do', () => {
    const output = [
      'Starting galaxy collection install process',
      'Nothing to do. All requested collections are already installed. If you want to reinstall them, consider using `--force`.',
    ]

    expect(galaxyResults(asked, output)).toEqual([
      { name: 'geerlingguy.mac', version: null, installed: false },
      { name: 'community.general', version: null, installed: false },
    ])
  })
})
