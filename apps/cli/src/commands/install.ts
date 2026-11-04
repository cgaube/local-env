import { Command } from 'commander'
import { execa } from 'execa'
import { readConfig } from '#cli/core/config.js'
import {
  forgetUnpicked,
  readPickedTools,
  runPlaybook,
  unpickTools,
} from '#cli/core/tools.js'
import { hasCommand, logger } from '#cli/utils/index.js'

// Last in the output, where it is seen
const showForgotten = (forgotten: string[]) => {
  if (forgotten.length === 0) return
  const one = forgotten.length === 1
  logger.callout(
    'info',
    [
      'Unpicked, still on this Mac',
      forgotten.map((id) => id.split('/')[1]).join(', '),
      `local-env doesn't uninstall: remove ${one ? 'it' : 'them'} yourself if you want ${one ? 'it' : 'them'} gone. ${one ? 'It is' : 'They are'} no longer listed as installed.`,
    ].join('\n'),
    { tinted: true, padded: false },
  )
}

// Tools are picked in the dashboard, which can't run anything on the Mac:
// this runs what was picked
export const installCommand = new Command('install')
  .description('Install the tools picked in the dashboard (Tools)')
  .option('-v, --verbose', "Show Ansible's own output", false)
  .action(async (options: { verbose: boolean }) => {
    let forgotten: string[] = []
    try {
      const catalog = `https://local-env.${readConfig().domain}/tools`
      const { roles, missing } = readPickedTools()

      if (missing.length > 0) {
        unpickTools(missing)
        logger.warn(
          `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer in your sources: unpicked. local-env doesn't uninstall: ${missing.length === 1 ? 'it stays' : 'they stay'} on this Mac.`,
        )
      }
      forgotten = forgetUnpicked(roles)
      if (roles.length === 0) {
        logger.info(
          `No tools picked yet. Pick them in the dashboard: ${catalog}`,
        )
        await execa('open', [catalog], { reject: false })
        showForgotten(forgotten)
        return
      }
      if (!(await hasCommand('ansible-playbook'))) {
        throw new Error(
          'Ansible is not installed. Run `local-env setup`, or `brew install ansible`.',
        )
      }

      const summary = await runPlaybook(roles, options)
      const count = `${roles.length} ${roles.length === 1 ? 'tool' : 'tools'}`
      logger.success(
        summary
          ? `Installed ${count} · ${summary.changed} changed`
          : `Installed ${count}`,
      )
      showForgotten(forgotten)
    } catch (error) {
      logger.error('Error installing tools:', error)
      showForgotten(forgotten)
      process.exit(1)
    }
  })
