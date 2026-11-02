import { execa } from 'execa'
import packageJson from '../../../../package.json' with { type: 'json' }
import { isBrewPackageInstalled } from '../utils/brew.js'
import { closeFrame, logger } from '../utils/logger.js'
import { runTask } from '../utils/task.js'
import {
  HOMEBREW_FORMULA,
  isNewer,
  RELEASES_PAGE,
  UPGRADE_COMMAND,
} from './homebrew.js'
import { CHECKOUT_DIR } from './paths.js'
import { checkLatestNow } from './update-check.js'

// Set for the new version that `update` hands over to: the version it came
// from, so it doesn't check again
const UPDATED_FROM = 'LOCAL_ENV_UPDATED_FROM'

// The first step of `update`: local-env itself. When Homebrew installs a newer
// version, the rest of the update must run on it (it restarts the core
// services, and the old binary would bring back their old version): this
// process then hands over to the new `local-env update`, with the same
// options, and exits with its code. Otherwise the update goes on here.
export const updateSelf = async ({ dryRun }: { dryRun: boolean }) => {
  const current = packageJson.version
  logger.group('local-env')

  const from = process.env[UPDATED_FROM]
  if (from) {
    logger.success(`Updated from ${from} to ${current}`)
    return
  }
  // A checkout is behind or ahead on purpose. Tests run one, with a fake
  // formula.
  if (CHECKOUT_DIR && !process.env.LOCAL_ENV_FORMULA_URL) {
    logger.info('Skipped: a checkout updates with git')
    return
  }

  const latest = await checkLatestNow()
  if (!latest) {
    logger.warn("Couldn't check for a new version: you may be offline")
    return
  }
  if (!isNewer(latest, current)) {
    logger.success(`local-env ${current} is the latest`)
    return
  }
  logger.info(`local-env ${latest} is out (you have ${current})`)
  if (dryRun) {
    logger.info('Not installed (dry run)')
    return
  }
  if (!(await isBrewPackageInstalled(HOMEBREW_FORMULA))) {
    logger.warn(
      `Not installed with Homebrew: download local-env ${latest} from ${RELEASES_PAGE}`,
    )
    return
  }

  await runTask(
    `Running ${UPGRADE_COMMAND}`,
    'brew',
    ['upgrade', HOMEBREW_FORMULA],
    {
      done: `Upgraded to local-env ${latest}`,
    },
  )
  closeFrame(`Continuing with local-env ${latest}`)
  // brew's link on PATH now points at the new version
  const next = await execa('local-env', process.argv.slice(2), {
    stdio: 'inherit',
    reject: false,
    env: { [UPDATED_FROM]: current },
  })
  process.exit(next.exitCode ?? 1)
}
