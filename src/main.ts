// CLI entrypoint. Run `local-env --help` for the current command list.

import { intro, outro } from '@clack/prompts'
import { Command } from 'commander'
import { styleText } from 'node:util'
import packageJson from '../package.json' with { type: 'json' }
import { commands } from './commands/index.js'
import { prepareHome } from './core/home.js'
import { findOutdatedServices } from './core/outdated.js'
import { brandTitle } from './utils/brand.js'
import { logger, markIntro } from './utils/logger.js'
import { CANCELLED_EXIT_CODE } from './utils/prompt.js'

const program = new Command()
  .name('local-env')
  .description('Local dev environment: HTTPS proxy and a Dockhand app catalog')
  // Bumped by `bun run version-packages` (changesets)
  .version(packageJson.version)

for (const command of commands) {
  program.addCommand(command)
}

// Titles shown at the top of each command, by command path
const TITLES: Record<string, string> = {
  setup: 'Set up DNS and HTTPS',
  start: 'Start local-env',
  stop: 'Stop local-env',
  status: 'Status',
  update: 'Update everything',
  'config get': 'Settings',
  'config set': 'Change a setting',
  'sources add': 'Add a source',
  'sources list': 'Sources',
  'sources remove': 'Remove a source',
  'sources sync': 'Sync stacks with their templates',
  'proxy routes': 'Proxy routes',
  doctor: 'Doctor',
  reset: 'Reset local-env',
}

// Set once the frame is open, so it is closed whichever way the command ends
let framed = false
// Core services running an older version of local-env, said inside the frame
let outdated: string[] = []

// Commands exit with process.exit(1) on errors: close the frame in red then.
// A cancelled prompt has closed it already.
process.on('exit', (code) => {
  if (framed && code !== 0 && code !== CANCELLED_EXIT_CODE) {
    outro(styleText('red', 'Failed'))
  }
})

// Frames every command with its title
program.hook('preAction', (_, command) => {
  const names: string[] = []
  for (let c = command; c.parent; c = c.parent) names.unshift(c.name())
  const path = names.join(' ')
  const title =
    TITLES[path] ?? `${path.charAt(0).toUpperCase()}${path.slice(1)}`
  if (process.stdout.isTTY) {
    intro(brandTitle(title))
    markIntro()
    framed = true
  }
  if (outdated.length > 0) {
    logger.info(
      `The core services run an older version of local-env (${outdated.join(', ')}). Run \`local-env start\` to update them.`,
    )
  }
})

// Only for commands: --version and --help leave the home folder alone
const command = process.argv[2] ?? ''
if (command && !command.startsWith('-') && command !== 'help') {
  await prepareHome()
  // start and update recreate them anyway
  if (!['start', 'update'].includes(command)) {
    outdated = await findOutdatedServices()
  }
}
await program.parseAsync()
// Piped output (scripts, CI) gets no frame
if (framed) {
  framed = false
  outro('Done')
}
