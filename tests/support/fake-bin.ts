import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'

// Every external binary the CLI runs, except git: tests use real git repos
// as sources. Anything else is missing from PATH, so a test can never reach
// the real Docker, Homebrew or sudo.
export const FAKED_COMMANDS = [
  'brew',
  'curl',
  'dig',
  'dnsmasq',
  'docker',
  'dscacheutil',
  'mkcert',
  'sudo',
  'which',
] as const

export type FakedCommand = (typeof FAKED_COMMANDS)[number]

export type FakeReply = {
  stdout?: string
  stderr?: string
  exitCode?: number
  // Writes content to the path given after each flag, as the real command
  // would: { '-cert-file': '<pem>' }
  writeArgs?: Record<string, string>
}

export type FakeRule = FakeReply & { command: string; match: string[] }

export type FakeCall = {
  command: string
  args: string[]
  // The LOCAL_ENV_* variables the call got (compose settings)
  env: Record<string, string>
  // false when no rule answered: the stub failed
  matched: boolean
}

const FAKE_PROGRAM = join(import.meta.dir, 'fake-bin/fake.ts')

const which = (command: string) => {
  const path = Bun.which(command)
  if (!path) throw new Error(`${command} is required to run the tests`)
  return path
}

// A PATH of stubs (plus the real git) and the state they share with the test
export const createFakeBin = (root: string) => {
  const bin = join(root, 'bin')
  const state = join(root, 'state')
  mkdirSync(bin, { recursive: true })
  mkdirSync(state, { recursive: true })

  const writeStub = (stub: string, command: FakedCommand) => {
    mkdirSync(dirname(stub), { recursive: true })
    writeFileSync(
      stub,
      `#!/bin/sh\nexec "${process.execPath}" "${FAKE_PROGRAM}" ${command} "$@"\n`,
    )
    chmodSync(stub, 0o755)
  }
  for (const command of FAKED_COMMANDS) writeStub(join(bin, command), command)
  symlinkSync(which('git'), join(bin, 'git'))

  const rules: FakeRule[] = []
  const rulesFile = join(state, 'rules.json')
  const callsFile = join(state, 'calls.jsonl')
  writeFileSync(rulesFile, '[]')

  return {
    path: bin,
    env: { FAKE_BIN_STATE: state },

    // A stub at an absolute path, for binaries the CLI doesn't find on PATH
    // (Homebrew's sbin/dnsmasq)
    stubAt: writeStub,

    // Replies to calls of `command` whose args start with match[0], then
    // contain the rest of `match` in order. The last rule added wins.
    on(command: FakedCommand, match: string[], reply: FakeReply = {}) {
      rules.push({ command, match, ...reply })
      writeFileSync(rulesFile, JSON.stringify(rules, null, 2))
    },

    calls(command?: FakedCommand): FakeCall[] {
      if (!existsSync(callsFile)) return []
      return readFileSync(callsFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeCall)
        .filter((call) => !command || call.command === command)
    },
  }
}

export type FakeBin = ReturnType<typeof createFakeBin>
