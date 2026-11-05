// Stands in for an external binary (docker, brew, mkcert, sudo…) in e2e tests.
// Each stub on PATH runs `bun fake.ts <command> <args…>`: this logs the call
// and replies from the rules the test wrote (tests/support/fake-bin.ts).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import type { FakeCall, FakeRule } from '#cli-tests/support/fake-bin.js'

const dir = process.env.FAKE_BIN_STATE
if (!dir) {
  console.error('fake: FAKE_BIN_STATE is not set')
  process.exit(127)
}

const [command = '', ...args] = process.argv.slice(2)

// `match` starts with the first argument (the subcommand), then its other
// items appear in this order, not necessarily next to each other:
// ['compose', 'down'] matches `compose -f <file> down`, not `ps --format …`
const matches = (match: string[]) => {
  if (match.length === 0) return true
  if (args[0] !== match[0]) return false
  let index = 1
  for (const arg of args.slice(1)) {
    if (index === match.length) break
    if (arg === match[index]) index++
  }
  return index === match.length
}

const rulesFile = join(dir, 'rules.json')
const rules: FakeRule[] = existsSync(rulesFile)
  ? JSON.parse(readFileSync(rulesFile, 'utf8'))
  : []
// The last rule added wins, so a test can override the defaults
const rule = rules.findLast(
  (candidate) =>
    candidate.command === command &&
    matches(candidate.match) &&
    Object.entries(candidate.env ?? {}).every(
      ([name, value]) => process.env[name] === value,
    ),
)

// The variables the CLI passes to compose, Ansible and mkcert
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      /^(LOCAL_ENV_|ANSIBLE_|TRUST_STORES$)/.test(entry[0]) &&
      entry[1] !== undefined,
  ),
)
// The YAML files it was given (a playbook), read now: the CLI may remove
// them once the call ends
const inputs = Object.fromEntries(
  args
    .filter((arg) => /\.ya?ml$/.test(arg) && existsSync(arg))
    .map((arg) => [arg, readFileSync(arg, 'utf8')]),
)
// The collections in the first folder of ANSIBLE_COLLECTIONS_PATH, by
// <namespace>.<name>: the folders they link to, read now too
const collectionsDir = join(
  env.ANSIBLE_COLLECTIONS_PATH?.split(':')[0] ?? '',
  'ansible_collections',
)
const collections = env.ANSIBLE_COLLECTIONS_PATH
  ? Object.fromEntries(
      (existsSync(collectionsDir) ? readdirSync(collectionsDir) : []).flatMap(
        (namespace) =>
          readdirSync(join(collectionsDir, namespace)).map((name) => [
            `${namespace}.${name}`,
            readlinkSync(join(collectionsDir, namespace, name)),
          ]),
      ),
    )
  : {}
const call: FakeCall = {
  command,
  args,
  env,
  inputs,
  collections,
  matched: Boolean(rule),
}
appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify(call)}\n`)

// Unknown calls fail loudly: a test never passes by accident
if (!rule) {
  console.error(`fake ${command}: no rule for: ${args.join(' ')}`)
  process.exit(1)
}
// The files the real command would create: mkcert -cert-file <path>…
for (const [flag, content] of Object.entries(rule.writeArgs ?? {})) {
  const path = args[args.indexOf(flag) + 1]
  if (!args.includes(flag) || !path) continue
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
if (rule.runMs) await Bun.sleep(rule.runMs)
if (rule.stdout) process.stdout.write(rule.stdout)
if (rule.stderr) process.stderr.write(rule.stderr)
process.exit(rule.exitCode ?? 0)
