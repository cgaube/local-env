// CLI entrypoint. Run `local-env --help` for the current command list.

import { intro, outro } from '@clack/prompts'
import { Command } from 'commander'
import { styleText } from 'node:util'
import packageJson from '#package.json' with { type: 'json' }
import { commands, hiddenCommands } from '#cli/commands/index.js'
import { prepareHome } from '#cli/core/home.js'
import { UPDATE_COMMAND } from '#cli/core/homebrew.js'
import { findOutdatedServices } from '#cli/core/outdated.js'
import { CHECKOUT_DIR } from '#cli/core/paths.js'
import { findNewerVersion } from '#cli/core/update-check.js'
import { brandTitle } from '#cli/utils/brand.js'
import { isFrameClosed, logger, markIntro } from '#cli/utils/logger.js'
import { CANCELLED_EXIT_CODE } from '#cli/utils/prompt.js'

const program = new Command()
  .name('local-env')
  .description('Local dev environment: HTTPS proxy and a Dockhand app catalog')
  // Bumped by `bun run version-packages` (changesets)
  .version(packageJson.version)

for (const command of commands) {
  program.addCommand(command, { hidden: hiddenCommands.has(command) })
}

// Titles shown at the top of each command, by command path
const TITLES: Record<string, string> = {
  setup: 'Set up DNS and HTTPS',
  ui: 'Every piece of the output',
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
  install: 'Install tools',
  'proxy routes': 'Proxy routes',
  doctor: 'Doctor',
  reset: 'Reset local-env',
}

// Set once the frame is open, so it is closed whichever way the command ends
let framed = false
// Core services running an older version of local-env, said inside the frame
let outdated: string[] = []
// A newer release of local-env, said inside the frame too
let newer: string | null = null

// Commands exit with process.exit(1) on errors: close the frame in red then.
// A cancelled prompt has closed it already.
process.on('exit', (code) => {
  if (
    framed &&
    !isFrameClosed() &&
    code !== 0 &&
    code !== CANCELLED_EXIT_CODE
  ) {
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
    logger.callout(
      'warn',
      [
        'Outdated core services',
        `They run an older version of local-env: ${outdated.join(', ')}.`,
        'Run `local-env start` to update them.',
      ].join('\n'),
      { tinted: true, padded: false },
    )
  }
  if (newer) {
    logger.callout(
      'info',
      [
        'A new version is available',
        `local-env ${newer} is out. Run \`${UPDATE_COMMAND}\` to get it.`,
      ].join('\n'),
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
  // A checkout is behind or ahead on purpose, and brew doesn't update it.
  // Tests run one, with a fake formula. update checks itself, and installs
  // the new version.
  if (
    command !== 'update' &&
    (!CHECKOUT_DIR || process.env.LOCAL_ENV_FORMULA_URL)
  ) {
    newer = await findNewerVersion(packageJson.version)
  }
}
await program.parseAsync()
// Piped output (scripts, CI) gets no frame
if (framed && !isFrameClosed()) {
  framed = false
  outro('Done')
}
