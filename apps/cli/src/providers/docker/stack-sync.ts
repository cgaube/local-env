import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logger } from '../../utils/logger.js'
import { askConfirm, askSelect } from '../../utils/prompt.js'
import { getLocalEnvironment } from './environments.js'
import {
  applyStackDiff,
  diffStack,
  findTemplatedStacks,
  unlinkStack,
  updateLink,
  type LinkCandidate,
  type LinkDecision,
  type StackDiff,
} from './template-sync.js'
import { findChangedBuilds, rebuildChangedStacks } from './stack-builds.js'
import { hashTemplate } from './template-link.js'

// git diff --no-index gives the familiar coloured output; run from a temp dir
// so the headers read a/current/compose.yaml -> b/template/compose.yaml
const printDiff = async ({ current, next }: StackDiff) => {
  const dir = mkdtempSync(join(tmpdir(), 'local-env-sync-'))
  try {
    for (const [name, content] of [
      ['current', current],
      ['template', next],
    ]) {
      mkdirSync(join(dir, name))
      writeFileSync(join(dir, name, 'compose.yaml'), content)
    }
    const { stdout } = await execa(
      'git',
      [
        'diff',
        '--no-index',
        '--color=always',
        'current/compose.yaml',
        'template/compose.yaml',
      ],
      { cwd: dir, reject: false },
    )
    logger.log(stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export type SyncOptions = {
  yes: boolean
  dryRun: boolean
  // Ask about stacks that look like a template (default). `update` doesn't.
  link?: boolean
  // Only the stacks of this source's templates
  source?: string
}

// Whether a template (<source>/<folder>) belongs to the source synced, if any
const inSource = (template: string, source?: string) =>
  !source || template.startsWith(`${source}/`)

// A stack without a link that uses a template's image: asks once which
// template it comes from. --yes links a single match without asking.
const askLink =
  ({ yes, dryRun }: SyncOptions) =>
  async ({ stack, templates }: LinkCandidate): Promise<LinkDecision> => {
    const list = templates.join(', ')
    if (dryRun) {
      logger.info(`${stack} uses the image of ${list}: not linked yet`)
      return null
    }
    if (yes) {
      if (templates.length === 1) {
        logger.info(`Linked ${stack} → ${templates[0]} (same image)`)
        return templates[0]!
      }
      logger.info(
        `${stack}: ${templates.length} templates use its image (${list}). Run \`local-env sources sync\` to choose.`,
      )
      return null
    }
    const never = {
      value: 'ignore',
      label: 'No, never ask again for this stack',
    }
    if (templates.length === 1) {
      const answer = await askSelect(
        `${stack} uses the image of the template ${templates[0]}. Link it, so updates keep it in sync with the template?`,
        [{ value: templates[0]!, label: 'Yes, link it' }, never],
      )
      if (answer !== 'ignore') logger.success(`Linked ${stack} → ${answer}`)
      return answer
    }
    const answer = await askSelect(
      `${stack} uses the image of several templates. Which one does it come from?`,
      [...templates.map((value) => ({ value, label: value })), never],
    )
    if (answer !== 'ignore') logger.success(`Linked ${stack} → ${answer}`)
    return answer
  }

// Shows each deployed stack's diff with its template and applies it on
// approval. Returns the names of the redeployed stacks.
export const syncTemplatedStacks = async ({
  yes,
  dryRun,
  link = true,
  source,
}: SyncOptions) => {
  const environment = await getLocalEnvironment()
  const ask = askLink({ yes, dryRun })
  const found = await findTemplatedStacks(
    environment.id,
    link
      ? async (candidate) => {
          // Only this source's templates are offered
          const templates = candidate.templates.filter((template) =>
            inSource(template, source),
          )
          return templates.length ? ask({ ...candidate, templates }) : null
        }
      : undefined,
  )
  const stacks = found.stacks.filter((stack) =>
    inSource(stack.template, source),
  )
  const ambiguous = found.ambiguous.filter((stack) =>
    stack.templates.some((template) => inSource(template, source)),
  )
  for (const { stack, name, templates } of ambiguous) {
    logger.warn(
      `${stack}: several templates are named "${name}" (${templates.join(', ')}), not updated`,
    )
  }
  if (stacks.length === 0) {
    logger.info('No stacks deployed from a template')
    return []
  }

  const applied: string[] = []
  for (const linked of stacks) {
    const label = `${linked.stack} (${linked.template})`
    let diff: StackDiff | null
    try {
      diff = await diffStack(environment.id, linked)
    } catch (error) {
      logger.warn(`${label}: ${(error as Error).message}, skipped`)
      continue
    }

    if (!diff) {
      logger.success(`${label}: up to date`)
      continue
    }
    if (diff.nextBase === linked.skip) {
      logger.info(`${label}: template version skipped`)
      continue
    }

    logger.group(`${label}: template changed`)
    await printDiff(diff)
    // Both cases replace some of the user's own edits: never applied blindly
    const needsReview = diff.conflicts > 0 || diff.missingBase
    if (diff.conflicts > 0) {
      logger.warn(
        `${diff.conflicts} part(s) changed both in this stack and in the template. Applying takes the template's version of each whole part, including your nearby lines: check the diff.`,
      )
    }
    if (diff.missingBase) {
      logger.warn(
        "The deployed template version wasn't recorded, so your own edits to this stack can't be kept. Applying replaces it with the template.",
      )
    }
    if (diff.missingVariables.length > 0) {
      logger.warn(
        `New required variables not set on the stack: ${diff.missingVariables.join(', ')}. Set them in Dockhand first or the redeploy fails.`,
      )
    }
    if (dryRun) continue

    if (yes && needsReview) {
      logger.info(`${linked.stack}: skipped, review it without --yes`)
      continue
    }
    const answer = yes
      ? 'apply'
      : await askSelect(
          `Apply template changes to "${linked.stack}" and redeploy?`,
          [
            { value: 'apply', label: 'Yes, apply and redeploy' },
            { value: 'later', label: 'Not now', hint: 'ask again next time' },
            {
              value: 'skip',
              label: 'Skip this template version',
              hint: 'ask again when the template changes',
            },
            {
              value: 'unlink',
              label: 'Unlink this stack',
              hint: 'never sync it with its template',
            },
          ],
        )

    const undo = `\`local-env sources links --forget ${linked.stack}\` undoes it`
    if (answer === 'skip') {
      updateLink(linked.stack, { skip: diff.nextBase })
      logger.info(`${linked.stack}: version skipped, ${undo}`)
      continue
    }
    if (answer === 'unlink') {
      unlinkStack(linked.stack)
      logger.info(`${linked.stack}: unlinked, ${undo}`)
      continue
    }
    if (answer !== 'apply') {
      logger.info(`${linked.stack}: left unchanged`)
      continue
    }

    await applyStackDiff(environment.id, diff)
    applied.push(linked.stack)
    logger.success(`${linked.stack}: updated and redeployed`)
  }

  return applied
}

// Prints every stack local-env knows about: linked ones with their template,
// how they were linked and whether the template changed since, then the ones
// that look like a template and the ones the user chose not to link
export const printStackLinks = async () => {
  const environment = await getLocalEnvironment()
  const { stacks, ambiguous, unlinked, ignored } = await findTemplatedStacks(
    environment.id,
  )
  const rows = [
    ...stacks.map((stack) => [
      stack.stack,
      stack.template,
      stack.how === 'image' ? 'same image' : 'name:',
      !stack.base
        ? 'version unknown'
        : hashTemplate(stack.latest) === stack.base
          ? 'up to date'
          : hashTemplate(stack.latest) === stack.skip
            ? 'version skipped'
            : 'template changed',
    ]),
    ...unlinked.map(({ stack, templates }) => [
      stack,
      '—',
      'not linked',
      `uses the image of ${templates.join(', ')}`,
    ]),
    ...ambiguous.map(({ stack, name, templates }) => [
      stack,
      '—',
      'not linked',
      `templates ${templates.join(', ')} are all named "${name}"`,
    ]),
    ...ignored.map((stack) => [stack, '—', 'unlinked', '—']),
  ]
  if (rows.length === 0) {
    logger.info('No stacks deployed from a template')
    return
  }

  const header = ['STACK', 'TEMPLATE', 'HOW', 'STATUS']
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]!.length)),
  )
  const line = (row: string[]) =>
    row
      .map((value, column) => value.padEnd(widths[column]!))
      .join('  ')
      .trimEnd()
  logger.log([line(header), ...rows.map(line)].join('\n'))
  if (unlinked.length > 0) {
    logger.info('Run `local-env sources sync` to link the stacks not linked')
  }
}

// The whole sync: template changes, then rebuilds of the stacks whose build
// folders changed. `sources sync` runs it, and `update` on approval.
export const syncStacks = async (options: SyncOptions) => {
  const applied = await syncTemplatedStacks(options)
  const environment = await getLocalEnvironment()
  const rebuilt = await rebuildChangedStacks(environment.id, options)
  return { applied, rebuilt }
}

// What a sync would offer, without asking or redeploying anything
const findPendingSync = async ({ dryRun }: { dryRun: boolean }) => {
  const environment = await getLocalEnvironment()
  const { stacks } = await findTemplatedStacks(environment.id)
  const changed: string[] = []
  for (const stack of stacks) {
    try {
      const diff = await diffStack(environment.id, stack)
      if (diff && diff.nextBase !== stack.skip) changed.push(stack.stack)
    } catch {
      // The sync reports the error
      changed.push(stack.stack)
    }
  }
  const builds = await findChangedBuilds({ dryRun })
  return { changed, builds: builds.map(({ stack }) => stack) }
}

// For `update`: lists what changed in the templates of linked stacks and
// offers to sync now. --yes syncs without asking; --dry-run only lists.
// Stacks that only look like a template are left to `sources sync`: stacks
// made by hand shouldn't come up on every update.
export const offerStackSync = async (options: SyncOptions) => {
  const { changed, builds } = await findPendingSync(options)
  const pending = [
    ...(changed.length ? [`Template changed: ${changed.join(', ')}`] : []),
    ...(builds.length ? [`Build folders changed: ${builds.join(', ')}`] : []),
  ]
  if (pending.length === 0) {
    logger.success('Stacks up to date with their templates')
    return { applied: [], rebuilt: [] }
  }
  for (const line of pending) logger.info(line)

  const later = 'Run `local-env sources sync` to review them'
  if (options.dryRun) {
    logger.info(later)
    return { applied: [], rebuilt: [] }
  }
  if (!options.yes && !(await askConfirm('Review and sync them now?', true))) {
    logger.info(later)
    return { applied: [], rebuilt: [] }
  }
  return syncStacks({ ...options, link: false })
}
