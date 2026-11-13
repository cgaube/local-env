import { Command } from 'commander'
import { existsSync } from 'fs'
import { CONFIG_PATH, readConfig } from '#cli/core/config.js'
import { runStart } from '#cli/core/start.js'
import { checkManifest } from '#cli/logins/index.js'
import { addSource } from '#cli/sources/sources.js'
import { logger } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
import { runSetup } from '#cli/commands/setup.js'
import { describeInstalled, runInstall } from '#cli/commands/install.js'
import { logInToEveryLogin } from '#cli/commands/login.js'
import { checkAddedSource } from '#cli/commands/sources.js'
import { ensureBootstraps } from '#cli/core/bootstrap.js'

// A new employee's first run, from their company's onboarding script: setup
// with the defaults, the team's source, start, the source's bootstrap, its
// logins, then the profile (docs/3-how-it-works/source-bootstrap.md). Hidden from
// --help: the everyday commands are start, update and install. Safe to run
// again: each step skips what is done, so a fix (Docker started, git login)
// goes on from where it stopped.
export const onboardCommand = new Command('onboard')
  .description(
    "Set up local-env with your team's source, then install a profile",
  )
  .argument('<source>', "Git URL or path of your team's source")
  .option(
    '-p, --profile <profile>',
    'The profile to install (default: pick one, unless one is saved)',
  )
  .option(
    '-d, --domain <domain>',
    'Domain for local services, on the first setup only (dev.test)',
  )
  .action(
    async (source: string, options: { profile?: string; domain?: string }) => {
      try {
        // The domain of a Mac set up before stays: the employee may have
        // changed it
        const configured = existsSync(CONFIG_PATH)
        await runSetup({
          yes: true,
          values:
            options.domain && !configured ? { domain: options.domain } : {},
        })
        const { domain } = readConfig()
        if (options.domain && configured && options.domain !== domain) {
          logger.info(`Keeps your domain, ${domain}`)
        }

        // Cloned before the start, which provisions Dockhand with it and
        // asks for its registry logins
        logger.group('Sources')
        await addSource(source, {
          checkManifest,
          checkSource: checkAddedSource,
        })
        await runStart({ build: false, summary: false })
        // What the logins use (a CLI, an AWS profile), then the logins, so
        // the install reads its secrets and pulls its images at once
        await ensureBootstraps()
        const failed = await logInToEveryLogin()
        if (failed.length > 0) {
          logger.callout(
            'warn',
            [
              `Not logged in: ${failed.join(', ')}`,
              'The install goes on: what needs them stops it. Fix them, then run `local-env login`.',
            ].join('\n'),
          )
        }
      } catch (error) {
        logger.error('Onboarding failed:', error)
        process.exit(1)
      }

      const installed = await runInstall(options.profile, {
        save: true,
        verbose: false,
        dryRun: false,
      })
      // Last, in green, in place of "Done": what was done, and where to go
      closeFrameWithCallout(
        'success',
        [
          'local-env is ready',
          ...(installed ? describeInstalled(installed) : []),
          `Dashboard: https://local-env.${readConfig().domain}`,
        ].join('\n'),
        { tinted: true },
      )
    },
  )
