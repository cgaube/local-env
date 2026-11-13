import { Command } from 'commander'
import { homedir } from 'os'
import { provisionProviders } from '#cli/providers/index.js'
import { refreshDockhand } from '#cli/providers/docker/index.js'
import { getRegistries, sourcesNeedingLogin } from '#cli/logins/registry.js'
import { createStatusCache, sourceLoginLines } from '#cli/logins/listing.js'
import { pruneUnusedLogins } from '#cli/logins/wanted.js'
import {
  printStackLinks,
  syncStacks,
} from '#cli/providers/docker/stack-sync.js'
import { forgetLink } from '#cli/providers/docker/template-sync.js'
import {
  addSource,
  describeSource,
  getSourceUrl,
  listSources,
  pullSources,
  readSourceContent,
  removeSource,
  summarizeSourceContent,
} from '#cli/sources/sources.js'
import { logger } from '#cli/utils/index.js'
import { askSelect } from '#cli/utils/prompt.js'
import { checkManifest } from '#cli/logins/index.js'
import { checkBootstrap, sourceBootstrap } from '#cli/core/bootstrap-plan.js'
import { offerBootstraps, runBootstraps } from '#cli/core/bootstrap.js'
import { listCatalog } from '#cli/core/tools.js'

// For `sources add` and `onboard`: refuses a source whose bootstrap can't
// run (a role missing, one that gets a secret, names a login or needs a
// stack)
export const checkAddedSource = (name: string) =>
  checkBootstrap(listCatalog(), name)

const withErrors =
  <A extends unknown[]>(action: (...args: A) => Promise<void>) =>
  async (...args: A) => {
    try {
      await action(...args)
    } catch (error) {
      logger.error('Sources failed:', error)
      process.exit(1)
    }
  }

const addCommand = new Command('add')
  .description('Clone a git repo of docker templates and ansible roles')
  .argument('<repo>', 'Git URL or path of a local git repo')
  .action(
    withErrors(async (repo: string) => {
      logger.group('Sources')
      const added = await addSource(repo, {
        checkManifest,
        checkSource: checkAddedSource,
      })
      if (!added) return
      // Before the provisioning: it may set up what the registry logins use
      await offerBootstraps({ sources: [added] })
      await provisionProviders()
    }),
  )

const listCommand = new Command('list').description('List sources').action(
  withErrors(async () => {
    const names = listSources()
    if (names.length === 0) {
      logger.info('No sources. Add one with: local-env sources add <repo>')
      return
    }
    // Only asks Dockhand when a source needs a login
    const registries =
      sourcesNeedingLogin().length > 0
        ? await getRegistries().catch(() => undefined)
        : []
    const status = createStatusCache()
    // A group per source, like the other commands' output
    for (const name of names) {
      const url = await getSourceUrl(name).catch(() => 'no remote')
      const logins = await sourceLoginLines(name, registries, status)
      logger.group(describeSource(name))
      logger.info(url.replace(homedir(), '~'))
      logger.log(summarizeSourceContent(readSourceContent(name)))
      if (logins.length > 0) logger.log(logins.join('\n'))
    }
  }),
)

const removeCommand = new Command('remove')
  .description('Delete a source and unregister it')
  .argument(
    '[name]',
    'Source name from `local-env sources list` (default: pick from a list)',
  )
  .action(
    withErrors(async (given: string | undefined) => {
      const names = listSources()
      if (names.length === 0) {
        logger.info('No sources to remove')
        return
      }
      if (!given && !process.stdin.isTTY) {
        throw new Error('Name the source to remove: `local-env sources list`')
      }
      const name =
        given ??
        (await askSelect(
          'Which source do you want to remove?',
          names.map((value) => ({
            value,
            label: describeSource(value),
            hint: summarizeSourceContent(readSourceContent(value)),
          })),
        ))
      logger.group('Sources')
      removeSource(name)
      // The AWS profiles local-env wrote for its logins
      pruneUnusedLogins()
      logger.success(`Removed ${name}`)
      await provisionProviders()
    }),
  )

const syncCommand = new Command('sync')
  .description(
    'Pull the sources, compare deployed stacks with their template, apply changes and rebuild on approval',
  )
  .option('-y, --yes', 'Apply every change without asking', false)
  .option('--dry-run', 'Only show the differences', false)
  .option('--no-pull', 'Compare with the sources as they are, without pulling')
  .argument('[source]', 'Only this source and its stacks (default: all)')
  .action(
    withErrors(
      async (
        source: string | undefined,
        options: { yes: boolean; dryRun: boolean; pull: boolean },
      ) => {
        if (source && !listSources().includes(source)) {
          throw new Error(
            `No source named "${source}". See \`local-env sources list\`.`,
          )
        }
        // The same as `update`, without the core stack and the images
        if (options.pull) {
          await pullSources(source ? [source] : undefined)
          // Points Dockhand at the new template lists; a dry run skips it, as
          // it may start Dockhand
          if (!options.dryRun) await refreshDockhand()
        }
        // A bootstrap that changed: asked first, as the stacks' secrets may
        // need what it sets up
        if (options.pull && !options.dryRun) {
          await offerBootstraps({
            yes: options.yes,
            sources: source ? [source] : undefined,
            changedOnly: true,
          })
        }
        logger.group('Stacks')
        const { applied, rebuilt } = await syncStacks({ ...options, source })
        if (applied.length > 0) {
          logger.success(`${applied.length} stack(s) updated`)
        }
        if (rebuilt.length > 0) {
          logger.success(`${rebuilt.length} stack(s) rebuilt`)
        }
      },
    ),
  )

const linksCommand = new Command('links')
  .description('List the stacks deployed from a template, and their template')
  .option(
    '--forget <stack>',
    'Forget what was decided for a stack (its link, a skipped version, unlinked): the next sync asks again',
  )
  .action(
    withErrors(async (options: { forget?: string }) => {
      if (options.forget) {
        if (forgetLink(options.forget)) {
          logger.success(
            `Forgot ${options.forget}: the next \`local-env sources sync\` links it again or asks`,
          )
        } else {
          logger.info(`${options.forget}: nothing recorded for this stack`)
        }
        return
      }
      await printStackLinks()
    }),
  )

const bootstrapCommand = new Command('bootstrap')
  .description(
    'Run the bootstrap of the sources: the roles of their manifest that make this Mac ready for their logins',
  )
  .argument('[source]', 'Only this source (default: all)')
  .option('-v, --verbose', "Show Ansible's own output", false)
  .action(
    withErrors(
      async (source: string | undefined, options: { verbose: boolean }) => {
        const sources = source ? [source] : listSources()
        if (source && !listSources().includes(source)) {
          throw new Error(
            `No source named "${source}". See \`local-env sources list\`.`,
          )
        }
        const catalog = listCatalog()
        // Run again even when done: the command is asked for
        const plans = sources.flatMap(
          (name) => sourceBootstrap(catalog, name) ?? [],
        )
        if (plans.length === 0) {
          logger.info(
            source ? `${source} has no bootstrap` : 'No source has a bootstrap',
          )
          return
        }
        await runBootstraps(catalog, plans, options)
      },
    ),
  )

export const sourcesCommand = new Command('sources')
  .description('Manage the repos of docker templates and ansible roles')
  .addCommand(addCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(syncCommand)
  .addCommand(linksCommand)
  .addCommand(bootstrapCommand)
