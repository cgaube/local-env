import { execa } from 'execa'
import { join } from 'path'

// The values of the roles' secrets, for Ansible: a named pipe in the run
// folder, which Ansible reads once (`--extra-vars @<pipe>`), each secret as
// the variable of its name. The values go from local-env to Ansible through
// the kernel, never to the disk. Each one is tagged !unsafe: Ansible never
// templates it, so a secret can hold `{{`.
// docs/3-how-it-works/logins.md explains why.

// "value" as YAML: a JSON string is a valid double-quoted YAML scalar
const unsafe = (value: string) => `!unsafe ${JSON.stringify(value)}`

export const secretsYaml = (secrets: Record<string, string>) =>
  Object.entries(secrets)
    .map(([name, value]) => `${name}: ${unsafe(value)}\n`)
    .join('')

// System tools, by their path: not tools to find in PATH
const MKFIFO = '/usr/bin/mkfifo'
const SH = '/bin/sh'

// Where the pipe is, in the run folder, for --extra-vars
export const secretsPath = (dir: string) => join(dir, 'secrets.yml')

export const pipeSecrets = async (
  dir: string,
  secrets: Record<string, string>,
) => {
  const path = secretsPath(dir)
  await execa(MKFIFO, ['-m', '600', path])
  // A writer that the kernel holds in open() until Ansible opens the pipe,
  // then writes and closes: Ansible reads to the end. The values reach it on
  // its stdin, a pipe too. Not this process: a non-blocking open() fails when
  // the reader is not there yet.
  const writer = execa(SH, ['-c', 'exec /bin/cat > "$0"', path], {
    input: secretsYaml(secrets),
    reject: false,
  })
  return {
    path,
    // Once Ansible is done. A writer still waiting (Ansible stopped before
    // reading the pipe) is stopped.
    close: async () => {
      writer.kill()
      await writer
    },
  }
}
