// local-env's callback (src/core/ansible-callback/local_env.py) in a real
// ansible-playbook of each pinned ansible-core, which uvx gets: its events
// must be the ones the unit tests draw (tests/support/ansible-samples.ts).
// Outside tests/, so `test:cli` never runs it: `bun run test:ansible` does,
// in its own CI step. It needs uv (`mise install`) and, the first time, the
// network.
//
// After a version bump or a change to the callback or the sample role:
// `UPDATE_ANSIBLE_FIXTURES=1 bun run test:ansible` writes the events again.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execa, execaSync } from 'execa'
import { CALLBACK_NAME, writeCallback } from '#cli/core/ansible-callback.js'
import {
  ANSIBLE_CORE_VERSION,
  ANSIBLE_PYTHON_VERSION,
} from '#cli/core/ansible.js'
import {
  ANSIBLE_CORE_VERSIONS,
  SAMPLE_ROLES,
  sampleEventsFile,
} from '#cli-tests/support/ansible-samples.js'

const UPDATE = process.env.UPDATE_ANSIBLE_FIXTURES === '1'

if (execaSync('uvx', ['--version'], { reject: false }).exitCode !== 0) {
  throw new Error('test:ansible needs uv: run `mise install`')
}

// Ansible on this Mac, with its own Python: the run doesn't depend on the
// Pythons installed
const PLAYBOOK = `- hosts: localhost
  connection: local
  vars:
    ansible_python_interpreter: '{{ ansible_playbook_python }}'
  roles: [demo]
`

const runSample = async (version: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'local-env-ansible-'))
  try {
    writeFileSync(join(dir, 'playbook.yml'), PLAYBOOK)
    // No ansible.cfg of the user: an empty one wins over them all
    writeFileSync(join(dir, 'ansible.cfg'), '')
    return await execa(
      'uvx',
      [
        '--quiet',
        // The one local-env installs runs on its Python, as on the Macs
        ...(version === ANSIBLE_CORE_VERSION
          ? ['--python', ANSIBLE_PYTHON_VERSION]
          : []),
        '--from',
        `ansible-core==${version}`,
        'ansible-playbook',
        '--inventory',
        'localhost,',
        'playbook.yml',
      ],
      {
        cwd: dir,
        reject: false,
        stdin: 'ignore',
        // Only what the run needs: none of the user's ANSIBLE_* variables.
        // uv's own (a cache, an index) are kept.
        extendEnv: false,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) =>
              /^(PATH|HOME|TMPDIR|UV_.*)$/.test(name),
            ),
          ),
          ANSIBLE_CONFIG: join(dir, 'ansible.cfg'),
          ANSIBLE_HOME: join(dir, 'ansible'),
          ANSIBLE_LOCAL_TEMP: join(dir, 'tmp'),
          ANSIBLE_ROLES_PATH: SAMPLE_ROLES,
          ANSIBLE_CALLBACK_PLUGINS: writeCallback(dir),
          ANSIBLE_STDOUT_CALLBACK: CALLBACK_NAME,
        },
      },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe.concurrent('the local_env callback in ansible-core', () => {
  for (const version of ANSIBLE_CORE_VERSIONS) {
    test(
      `prints the sample events in ansible-core ${version}`,
      async () => {
        const { exitCode, stdout, stderr } = await runSample(version)

        // The sample's last task fails: 2. Anything else is Ansible's own
        // error (a callback it can't load), in its stderr.
        expect({ exitCode, stderr }).toEqual({ exitCode: 2, stderr: '' })
        const file = sampleEventsFile(version)
        if (UPDATE) writeFileSync(file, `${stdout}\n`)
        expect(`${stdout}\n`).toBe(readFileSync(file, 'utf8'))
      },
      // uvx downloads Python and ansible-core on its first run
      300_000,
    )
  }
})
