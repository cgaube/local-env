import { Command } from 'commander'
import { styleText } from 'node:util'
import { homedir } from 'os'
import { provisionProviders } from '../providers/index.js'
import { refreshTemplateSources } from '../providers/docker/index.js'
import { printStackLinks, syncStacks } from '../providers/docker/stack-sync.js'
import { forgetLink } from '../providers/docker/template-sync.js'
import {
  addSource,
  getSourceUrl,
  listSources,
  pullSources,
  readSourceContent,
  removeSource,
  sourceNameFromUrl,
  summarizeSourceContent,
} from '../sources/sources.js'
import { logger } from '../utils/index.js'
import { askSelect } from '../utils/prompt.js'

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
  .option('-n, --name <name>', 'Source name (default: repo name)')
  .action(
    withErrors(async (repo: string, options: { name?: string }) => {
      logger.group('Sources')
      await addSource(repo, options.name ?? sourceNameFromUrl(repo))
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
    const width = Math.max(...names.map((name) => name.length))
    const rows = await Promise.all(
      names.map(async (name) => {
        const content = summarizeSourceContent(readSourceContent(name))
        const url = await getSourceUrl(name).catch(() => 'no remote')
        return `${name.padEnd(width)}  ${content}  ${styleText('dim', url.replace(homedir(), '~'))}`
      }),
    )
    logger.log(rows.join('\n'))
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
            label: value,
            hint: summarizeSourceContent(readSourceContent(value)),
          })),
        ))
      logger.group('Sources')
      removeSource(name)
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
          if (!options.dryRun) await refreshTemplateSources()
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

export const sourcesCommand = new Command('sources')
  .description('Manage the repos of docker templates and ansible roles')
  .addCommand(addCommand)
  .addCommand(listCommand)
  .addCommand(removeCommand)
  .addCommand(syncCommand)
  .addCommand(linksCommand)
