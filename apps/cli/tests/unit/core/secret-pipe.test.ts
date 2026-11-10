import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pipeSecrets, secretsYaml } from '#cli/core/secret-pipe.js'

const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-pipe-'))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('the pipe of the secrets', () => {
  test('writes each value as unsafe YAML text, escaped', () => {
    expect(
      secretsYaml({ TOKEN: 'a "b"\nc {{ d }}', EMPTY: '', EMOJI: 'é🔑' }),
    ).toBe(
      [
        'local_env_secrets:',
        '  TOKEN: !unsafe "a \\"b\\"\\nc {{ d }}"',
        '  EMPTY: !unsafe ""',
        '  EMOJI: !unsafe "é🔑"',
        '',
      ].join('\n'),
    )
  })

  test('gives the values to whoever reads the pipe, once, and nothing to the disk', () =>
    withDir(async (dir) => {
      const pipe = await pipeSecrets(dir, { TOKEN: 'ghp_123' })
      expect(statSync(pipe.path).isFIFO()).toBe(true)
      expect(statSync(pipe.path).size).toBe(0)

      // Like Ansible: another process, while this one runs on
      const read = await promisify(execFile)('/bin/cat', [pipe.path])
      await pipe.close()

      expect(read.stdout).toBe(secretsYaml({ TOKEN: 'ghp_123' }))
    }))

  test('lets go of its writer when nothing reads the pipe', () =>
    withDir(async (dir) => {
      const pipe = await pipeSecrets(dir, { TOKEN: 'ghp_123' })

      await pipe.close()

      expect(existsSync(pipe.path)).toBe(true)
    }))
})
