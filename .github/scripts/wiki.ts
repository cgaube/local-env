// Turns docs/wiki into the pages of the repo's GitHub wiki. The docs are
// written and reviewed in the repo, beside the code; the wiki is their
// output, never edited by hand (wiki-sync.ts publishes it).
//
// - A page is named by its `# ` title, which must be unique: the wiki has no
//   folders. The title leaves the page, as the wiki shows the name above it.
// - docs/wiki/Home.md is the wiki's Home.
// - A top folder is a section of the sidebar, named after the folder:
//   `2-write-a-source` is "Write a source". A number before a dash orders the
//   sections and the pages, and is not shown.
// - A link to another page of docs/wiki points to that page; a link to a
//   file of the repo points to it on GitHub. A link to a file that does not
//   exist is an error.

import { posix } from 'path'

export type WikiOptions = {
  // Where a file of the repo is on GitHub: https://github.com/<repo>/blob/main
  blobUrl: string
  // The folder of the docs in the repo: docs/wiki
  root: string
  // Whether a file or folder of the repo exists, by its path in the repo
  exists: (path: string) => boolean
}

type Page = { path: string; name: string; body: string; section: string | null }

const ORDER = /^\d+-/

// "2-write-a-source" -> "Write a source"
export const sectionTitle = (folder: string) => {
  const words = folder.replace(ORDER, '').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The wiki's file for a page name: GitHub turns spaces into dashes
export const pageSlug = (name: string) => name.trim().replace(/\s+/g, '-')

const FENCE = /^\s*(```|~~~)/
const LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g

// Rewrites the links of the lines outside code blocks
const mapLinks = (body: string, map: (target: string) => string) => {
  let fenced = false
  return body
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      // Not inside inline code: split on backticks, odd parts are code
      return line
        .split('`')
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part.replace(
                LINK,
                (_all, bang: string, text: string, target: string) =>
                  `${bang}[${text}](${map(target)})`,
              ),
        )
        .join('`')
    })
    .join('\n')
}

// The pages and their sidebar, by file name of the wiki. Throws an Error
// that lists every problem.
export const buildWiki = (
  files: Record<string, string>,
  { blobUrl, root, exists }: WikiOptions,
): Record<string, string> => {
  const problems: string[] = []
  const pages: Page[] = Object.keys(files)
    .filter((path) => path.endsWith('.md'))
    .sort()
    .map((path) => {
      const content = files[path]!
      const title = /^# (.+)$/m.exec(content)
      if (!title) problems.push(`${root}/${path}: no "# " title`)
      const parts = path.split('/')
      return {
        path,
        name: path === 'Home.md' ? 'Home' : (title?.[1]?.trim() ?? path),
        body: content.replace(/^# .+\n+/m, ''),
        section: parts.length > 1 ? parts[0]! : null,
      }
    })

  const byPath = new Map(pages.map((page) => [page.path, page]))
  const seen = new Map<string, string>()
  for (const { name, path } of pages) {
    if (/[/:]/.test(name)) {
      problems.push(
        `${root}/${path}: a page name cannot have / or : ("${name}")`,
      )
    }
    const other = seen.get(name.toLowerCase())
    if (other) {
      problems.push(`${root}/${path} and ${root}/${other} are both "${name}"`)
    }
    seen.set(name.toLowerCase(), path)
  }
  if (!byPath.has('Home.md')) problems.push(`${root}/Home.md is missing`)

  const output: Record<string, string> = {}
  for (const page of pages) {
    const body = mapLinks(page.body, (target) => {
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return target
      const [file = '', anchor] = target.split('#')
      const fromRoot = posix.normalize(
        posix.join(posix.dirname(page.path), file),
      )
      const hash = anchor ? `#${anchor}` : ''
      const linked = byPath.get(fromRoot)
      if (linked) return `${pageSlug(linked.name)}${hash}`
      // A file of the repo, outside the wiki
      const inRepo = posix.normalize(
        posix.join(root, posix.dirname(page.path), file),
      )
      if (inRepo.startsWith('..') || !exists(inRepo)) {
        problems.push(
          `${root}/${page.path}: the link to ${target} goes nowhere`,
        )
        return target
      }
      return `${blobUrl}/${inRepo}${hash}`
    })
    output[`${pageSlug(page.name)}.md`] = body
  }

  // The sidebar: Home, then a list for each section, in the folders' order
  const sections = new Map<string, Page[]>()
  for (const page of pages) {
    if (!page.section) continue
    sections.set(page.section, [...(sections.get(page.section) ?? []), page])
  }
  output['_Sidebar.md'] = [
    '[Home](Home)',
    ...[...sections].map(([folder, list]) =>
      [
        '',
        `**${sectionTitle(folder)}**`,
        '',
        ...list.map(({ name }) => `- [${name}](${pageSlug(name)})`),
      ].join('\n'),
    ),
    '',
  ].join('\n')
  output['_Footer.md'] =
    `Written in [${root}](${blobUrl}/${root}) of the repo: edit the pages there, with a pull request. This wiki is rebuilt on every merge.\n`

  if (problems.length > 0) throw new Error(problems.join('\n'))
  return output
}
