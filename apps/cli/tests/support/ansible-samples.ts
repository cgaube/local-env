import { join } from 'path'

// The sample run of local-env's Ansible callback: a role
// (fixtures/ansible/roles/demo), and the events the callback printed for it
// in each ansible-core version that `bun run test:ansible` runs. The unit
// tests draw those events; test:ansible checks that real Ansible still
// prints them.

// The oldest version local-env supports, and the latest. Bump them on
// purpose, then `UPDATE_ANSIBLE_FIXTURES=1 bun run test:ansible`.
export const ANSIBLE_CORE_VERSIONS = ['2.17.14', '2.22.0'] as const

export const SAMPLE_DIR = join(import.meta.dir, '../fixtures/ansible')

export const SAMPLE_ROLES = join(SAMPLE_DIR, 'roles')

export const sampleEventsFile = (version: string) =>
  join(SAMPLE_DIR, 'events', `${version}.jsonl`)
