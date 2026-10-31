import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { HOME_DIR } from '../../core/paths.js'

// Links Dockhand stacks to the template they were deployed from, without
// adding anything to their compose file.
//
// - a stack is linked to the template with the same top-level compose `name:`.
//   Stacks without one, e.g. from container templates (type 1), are linked
//   once the user confirms a template that uses the same image.
// - services/catalog-server saves every compose version it serves to
//   template-snapshots/<source>/<folder>/<hash>.yml; the CLI does the same
//   for the compose files Dockhand generates from container templates
// - the deployed version of each stack (the merge base) is recorded in
//   template-links.json, with the stacks the user chose not to link

export const SNAPSHOTS_DIR = join(HOME_DIR, 'volumes/template-snapshots')
const LINKS_FILE = join(HOME_DIR, 'volumes/template-links.json')

export type TemplateLink = {
  // <source>/<folder>, e.g. acme/postgres for docker/postgres in acme, or
  // <source>/<slug> for a container template
  template: string
  // Hash of the template version deployed, or null when it is unknown
  base: string | null
  // Same compose `name:`, or same image confirmed by the user. Missing in
  // links from older versions: by name.
  how?: 'name' | 'image'
  // Hash of a template version the user chose to skip: not offered again
  // until the template changes
  skip?: string
  // Git tree hashes| 'image'
  // Git tree hashes of its build folders at the last build (stack-builds.ts)
  build?: string
}

// "Never ask again" for a stack that looks like a template, or a stack the
// user unlinked: never synced with a template
export type IgnoredStack = { ignored: true }

export type StackLink = TemplateLink | IgnoredStack

export const isLinked = (link: StackLink | undefined): link is TemplateLink =>
  link !== undefined && 'template' in link

export const hashTemplate = (content: string) =>
  createHash('sha256').update(content).digest('hex').slice(0, 12)

// The top-level `name:` of a compose file, which the deployed stack keeps
export const composeName = (compose: string) => {
  try {
    const parsed = Bun.YAML.parse(compose) as { name?: unknown } | null
    return typeof parsed?.name === 'string' && !parsed.name.startsWith('${')
      ? parsed.name
      : null
  } catch {
    return null
  }
}

export type Snapshot = { hash: string; content: string; savedAt: Date }

const snapshotDir = (template: string) =>
  join(SNAPSHOTS_DIR, ...template.split('/'))

// Every version of a template served to Dockhand or applied, newest first
export const listSnapshots = (template: string): Snapshot[] => {
  const dir = snapshotDir(template)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => {
      const file = join(dir, name)
      return {
        hash: name.slice(0, -'.yml'.length),
        content: readFileSync(file, 'utf8'),
        savedAt: statSync(file).mtime,
      }
    })
    .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime())
}

export const readSnapshot = (template: string, hash: string) => {
  const file = join(snapshotDir(template), `${hash}.yml`)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

export const saveSnapshot = (template: string, content: string) => {
  const file = join(snapshotDir(template), `${hashTemplate(content)}.yml`)
  if (existsSync(file)) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

export const readLinks = (): Record<string, StackLink> => {
  try {
    return JSON.parse(readFileSync(LINKS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

export const writeLinks = (links: Record<string, StackLink>) => {
  mkdirSync(dirname(LINKS_FILE), { recursive: true })
  writeFileSync(LINKS_FILE, `${JSON.stringify(links, null, 2)}\n`)
}

// A version served this recently may belong to a stack being deployed right
// now, not linked yet
const RECENT_MS = 24 * 60 * 60 * 1000

// Deletes the snapshots nothing needs: neither a linked stack's base, nor the
// template's current version, nor served in the last day. `current` maps
// each template that still exists to the hash of its current version.
export const pruneSnapshots = (
  links: Record<string, StackLink>,
  current: Map<string, string>,
) => {
  if (!existsSync(SNAPSHOTS_DIR)) return 0
  const bases = new Set(
    Object.values(links)
      .filter(isLinked)
      .map((link) => `${link.template}/${link.base}`),
  )
  const now = Date.now()
  let removed = 0
  for (const source of readdirSync(SNAPSHOTS_DIR)) {
    const sourceDir = join(SNAPSHOTS_DIR, source)
    if (!statSync(sourceDir).isDirectory()) continue
    for (const folder of readdirSync(sourceDir)) {
      const dir = join(sourceDir, folder)
      if (!statSync(dir).isDirectory()) continue
      const template = `${source}/${folder}`
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.yml')) continue
        const hash = name.slice(0, -'.yml'.length)
        const file = join(dir, name)
        const keep =
          bases.has(`${template}/${hash}`) ||
          current.get(template) === hash ||
          now - statSync(file).mtimeMs < RECENT_MS
        if (keep) continue
        rmSync(file)
        removed += 1
      }
      if (readdirSync(dir).length === 0) rmdirSync(dir)
    }
    if (readdirSync(sourceDir).length === 0) rmdirSync(sourceDir)
  }
  return removed
}
