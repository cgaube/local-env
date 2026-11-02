import { execa } from 'execa'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  contextPath,
  findBuildContexts,
} from '#services/catalog-server/template-compose.js'
import { SOURCES_DIR } from '../../sources/sources.js'
import { logger } from '../../utils/logger.js'
import { askConfirm } from '../../utils/prompt.js'
import { dockhandPost } from './api.js'
import { isLinked, readLinks } from './template-link.js'
import { resolveTemplateCompose, updateLink } from './template-sync.js'

// Templates with a relative `build:` are built by Dockhand from the source
// (services/catalog-server/template-compose.ts). A change in a build folder
// leaves the compose file as it was, so the template merge sees nothing:
// this redeploys such stacks with a build when their build folders change.

// The git tree hashes of a template's build folders in its source clone, or
// null when it builds nothing
const readBuildTree = async (template: string) => {
  const path = resolveTemplateCompose(template)
  const [source = '', folder = ''] = template.split('/')
  if (!path) return null
  const paths = findBuildContexts(readFileSync(path, 'utf8'))
    .map((context) => contextPath(folder, context))
    .filter((value): value is string => value !== null)
    .sort()
  if (paths.length === 0) return null

  const hashes = await Promise.all(
    paths.map(async (contextDir) => {
      const { stdout, exitCode } = await execa(
        'git',
        ['-C', join(SOURCES_DIR, source), 'rev-parse', `HEAD:${contextDir}`],
        { reject: false },
      )
      return exitCode === 0 ? stdout.trim() : 'missing'
    }),
  )
  return hashes.join(',')
}

export type RebuildOptions = { yes: boolean; dryRun: boolean; source?: string }

// The linked stacks whose build folders changed since their last build, only
// those of `source`'s templates if given
export const findChangedBuilds = async ({
  dryRun,
  source,
}: {
  dryRun: boolean
  source?: string
}) => {
  const changed: { stack: string; tree: string }[] = []
  for (const [stack, link] of Object.entries(readLinks())) {
    if (!isLinked(link)) continue
    if (source && !link.template.startsWith(`${source}/`)) continue
    const tree = await readBuildTree(link.template)
    if (!tree || tree === link.build) continue
    // Linked before builds were tracked: assume it runs the current version
    if (link.build === undefined) {
      if (!dryRun) updateLink(stack, { build: tree })
      continue
    }
    changed.push({ stack, tree })
  }
  return changed
}

// Redeploys with a build the linked stacks whose build folders changed since
// their last build. Returns the names of the rebuilt stacks.
export const rebuildChangedStacks = async (
  environmentId: number,
  { yes, dryRun, source }: RebuildOptions,
) => {
  const changed = await findChangedBuilds({ dryRun, source })
  if (changed.length === 0) return []

  const list = changed.map(({ stack }) => stack).join(', ')
  if (dryRun) {
    logger.info(`Build folders changed, to rebuild: ${list}`)
    return []
  }
  if (!yes && !(await askConfirm(`Rebuild and redeploy ${list}?`, true))) {
    logger.info(`${list}: left on the previous build`)
    return []
  }

  const rebuilt: string[] = []
  for (const { stack, tree } of changed) {
    const result = await dockhandPost<{ success?: boolean; error?: string }>(
      `/stacks/${encodeURIComponent(stack)}/deploy?env=${environmentId}`,
      { build: true },
    )
    if (result.success === false) {
      logger.warn(`${stack}: rebuild failed: ${result.error ?? 'unknown'}`)
      continue
    }
    updateLink(stack, { build: tree })
    rebuilt.push(stack)
    logger.success(`${stack}: rebuilt and redeployed`)
  }
  return rebuilt
}
