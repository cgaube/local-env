import { spawnSync } from 'child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ansible/local_env/core/plugins/lookup/secret.py, run by the real Ansible:
// the e2e tests fake ansible-playbook. Skipped where Ansible is not installed
// (CI); run it before a change to the plugin.
const HAS_ANSIBLE =
  spawnSync('ansible-playbook', ['--version'], { stdio: 'ignore' }).status === 0

// A run like local-env's: the collection linked, a collection role whose
// task uses the lookup, and the extra vars
const runLookup = (
  task: string,
  secrets: Record<string, Record<string, unknown>>,
) => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-lookup-'))
  try {
    const collections = join(dir, 'ansible_collections')
    mkdirSync(join(collections, 'local_env'), { recursive: true })
    symlinkSync(
      join(process.cwd(), 'ansible/local_env/core'),
      join(collections, 'local_env/core'),
    )
    const role = join(collections, 'acme/dev/roles/billing/tasks')
    mkdirSync(role, { recursive: true })
    writeFileSync(join(role, 'main.yml'), task)
    writeFileSync(
      join(dir, 'playbook.yml'),
      '- hosts: localhost\n  gather_facts: false\n  roles: [acme.dev.billing]\n',
    )
    writeFileSync(
      join(dir, 'extra-vars.json'),
      JSON.stringify({ local_env_secrets: { 'acme.dev.billing': secrets } }),
    )
    // A vendor CLI: prints its environment's secret, or fails
    const cli = join(dir, 'fake-aws')
    writeFileSync(
      cli,
      '#!/bin/sh\nif [ -n "$FAIL" ]; then echo "$FAIL" >&2; exit 255; fi\nprintf "%s\\n" "$SECRET"\n',
    )
    chmodSync(cli, 0o755)
    const result = spawnSync(
      'ansible-playbook',
      [
        '-i',
        'localhost,',
        '-e',
        `@${join(dir, 'extra-vars.json')}`,
        'playbook.yml',
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          ANSIBLE_COLLECTIONS_PATH: dir,
          ANSIBLE_LOCALHOST_WARNING: 'false',
          ANSIBLE_PYTHON_INTERPRETER: 'auto_silent',
          ANSIBLE_NOCOLOR: '1',
          FAKE_CLI: cli,
        },
      },
    )
    return { output: `${result.stdout}${result.stderr}`, status: result.status }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const SHOW = (term: string) =>
  `- ansible.builtin.debug:\n    msg: "value={{ lookup('local_env.core.secret', '${term}') }}"\n`

const spec = (env: Record<string, string>, keys: string[] = []) => ({
  title: 'billing/dev, acme-dev',
  argv: ['sh', '-c', '"$FAKE_CLI"'],
  keys,
  env,
  hint: 'If your session ended: local-env sources login acme --login acme-dev',
})

describe.skipIf(!HAS_ANSIBLE)('the lookup local_env.core.secret', () => {
  test('runs the command with its environment, and takes the field', () => {
    const { output, status } = runLookup(SHOW('stripe_key'), {
      stripe_key: spec(
        { SECRET: JSON.stringify({ stripe_key: 'sk_{{ x }}', db: 'pw' }) },
        ['stripe_key'],
      ),
    })

    expect(status).toBe(0)
    // As it is: a secret is never templated again
    expect(output).toContain('"msg": "value=sk_{{ x }}"')
  })

  test('gives the whole text without a field', () => {
    const { output } = runLookup(SHOW('token'), {
      token: spec({ SECRET: 'ghp_123' }),
    })

    expect(output).toContain('"msg": "value=ghp_123"')
  })

  test('fails with the error of the CLI and how to log in', () => {
    const { output, status } = runLookup(SHOW('token'), {
      token: spec({ FAIL: 'Error loading SSO Token: Token for acme expired' }),
    })

    expect(status).not.toBe(0)
    expect(output).toContain(
      'acme.dev.billing: the secret token (billing/dev, acme-dev) could not be read: Error loading SSO Token: Token for acme expired',
    )
    expect(output).toContain('local-env sources login acme --login acme-dev')
  })

  test('names the secrets the role declares, for an unknown one', () => {
    const { output, status } = runLookup(SHOW('nope'), {
      token: spec({ SECRET: 'x' }),
    })

    expect(status).not.toBe(0)
    expect(output).toContain(
      'acme.dev.billing declares no secret named nope in the secrets: of its local-env.yml (it declares: token)',
    )
  })

  test('says when the field is missing', () => {
    const { output } = runLookup(SHOW('stripe_key'), {
      stripe_key: spec({ SECRET: '{"other": 1}' }, ['stripe_key']),
    })

    expect(output).toContain(
      'the secret stripe_key (billing/dev, acme-dev) has no field stripe_key',
    )
  })
})
