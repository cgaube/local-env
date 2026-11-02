// Every command has e2e tests: a `describe('local-env <command>')` block in
// tests/e2e/commands/. Coverage can't measure the CLI processes the e2e tests
// start, so this is the rule CI enforces instead.
import type { Command } from 'commander'
import { Glob } from 'bun'
import { readFileSync } from 'fs'
import { join } from 'path'
import { commands } from '#cli/commands/index.js'

const COMMANDS_DIR = join(import.meta.dir, 'commands')

// The commands that run something: `sources add`, not `sources`
const leafCommands = (command: Command, parents: string[] = []): string[] => {
  const path = [...parents, command.name()]
  return command.commands.length > 0
    ? command.commands.flatMap((sub) => leafCommands(sub, path))
    : [path.join(' ')]
}

// "local-env config set, applied" -> "config set", also in
// describe.concurrent()
const testedCommands = () =>
  new Set(
    [...new Glob('**/*.test.ts').scanSync({ cwd: COMMANDS_DIR })].flatMap(
      (file) =>
        [
          ...readFileSync(join(COMMANDS_DIR, file), 'utf8').matchAll(
            /describe(?:\.\w+)*\(\s*['"`]local-env ([a-z][a-z -]*[a-z])/g,
          ),
        ].map(([, command]) => command!),
    ),
  )

const tested = testedCommands()

test.each(commands.flatMap((command) => leafCommands(command)))(
  'local-env %s has e2e tests',
  (command) => {
    expect(
      tested.has(command),
      `Add describe('local-env ${command}') to tests/e2e/commands/`,
    ).toBe(true)
  },
)
