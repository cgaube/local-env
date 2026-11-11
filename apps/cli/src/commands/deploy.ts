import { Command } from 'commander'
import {
  appUrls,
  type CatalogTemplate,
  listTemplates,
} from '#services/dashboard/templates.js'
import { readConfig } from '#cli/core/config.js'
import { SOURCES_DIR } from '#cli/sources/sources.js'
import { closeFrameWithCallout, logger } from '#cli/utils/logger.js'
import { askConfirm, askSelect, canAsk } from '#cli/utils/prompt.js'
import { getLocalEnvironment } from '#cli/providers/docker/environments.js'
import {
  deployStacks,
  listStackNames,
  prepareStacks,
  readCandidate,
} from '#cli/providers/docker/stack-deploy.js'

// Deploys one template of the sources as a Dockhand stack: from the
// dashboard's Docker page (the agent runs it in its terminal) or here. What
// `install` does for the stacks a tool needs: the registry logins, the
// secrets from the vault, the variables to give, then linked to its template.
// A template deploys once: an existing stack of its name is left alone.

const label = ({ title, id }: CatalogTemplate) => `${title} (${id})`

// <source>/<folder>, or a folder or stack name only one source has
const findTemplate = (templates: CatalogTemplate[], name: string) => {
  if (name.includes('/')) {
    const found = templates.find(({ id }) => id === name)
    if (!found) throw new Error(`No template ${name} in your sources`)
    return found
  }
  const matches = templates.filter(
    (template) => template.folder === name || template.name === name,
  )
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0)
    throw new Error(`No template ${name} in your sources`)
  throw new Error(
    `Several sources have ${name}: ${matches.map(({ id }) => id).join(', ')}. Name one of them.`,
  )
}

const pickTemplate = async (templates: CatalogTemplate[]) => {
  if (!canAsk()) {
    logger.group('Templates')
    for (const template of templates) logger.log(label(template))
    throw new Error('Name a template: local-env deploy <source>/<template>')
  }
  const id = await askSelect(
    'Which template?',
    templates.map((template) => ({
      value: template.id,
      label: template.title,
      hint: template.id,
    })),
  )
  return templates.find((template) => template.id === id)!
}

export const deployCommand = new Command('deploy')
  .description('Deploy a template of your sources in Docker (Dockhand)')
  .argument(
    '[template]',
    'The template: <source>/<template>, or its name when one source has it',
  )
  .option('-y, --yes', 'Deploy without asking first')
  .action(async (name: string | undefined, options: { yes?: boolean }) => {
    try {
      const templates = listTemplates(SOURCES_DIR)
      if (templates.length === 0) {
        throw new Error(
          'Your sources have no templates. Add one: local-env sources add <repo>',
        )
      }
      const template = name
        ? findTemplate(templates, name)
        : await pickTemplate(templates)
      const retry = `local-env deploy ${template.id}`

      const candidate = await readCandidate(template.id)
      if (!candidate)
        throw new Error(`No template ${template.id} in your sources`)

      let environmentId: number
      let existing: Set<string>
      try {
        environmentId = (await getLocalEnvironment()).id
        existing = await listStackNames(environmentId)
      } catch {
        throw new Error("Dockhand doesn't answer: run local-env start first")
      }
      if (existing.has(candidate.name)) {
        closeFrameWithCallout(
          'info',
          `${candidate.name} is deployed already: change it in Dockhand. local-env sources sync brings it the template's changes.`,
        )
        return
      }

      if (!options.yes) {
        if (!canAsk()) {
          throw new Error(`Run ${retry} in a terminal, or with --yes`)
        }
        if (!(await askConfirm(`Deploy ${label(template)} in Docker?`, true))) {
          logger.info('Not deployed')
          return
        }
      }

      const plan = await prepareStacks(environmentId, [candidate], retry)
      const done = plan ? await deployStacks(plan, retry) : []
      if (done.length === 0) process.exit(1)
      const urls = appUrls(template.hosts, readConfig().domain)
      closeFrameWithCallout(
        'success',
        urls.length > 0
          ? [`Deployed ${template.title}`, ...urls].join('\n')
          : `Deployed ${template.title}: manage it in Dockhand`,
        { tinted: true },
      )
    } catch (error) {
      logger.error('Error deploying:', error)
      process.exit(1)
    }
  })
