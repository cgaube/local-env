// Publishes docs/wiki to the repo's GitHub wiki (wiki.ts).
//
// Usage: bun wiki-sync.ts <wiki checkout>   writes the pages there
//        bun wiki-sync.ts --check           only builds them: fails on a
//                                           problem (CI)
//
// The checkout then holds exactly the pages of docs/wiki: a page removed
// from the docs leaves the wiki.

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join, relative } from 'path'
import { buildWiki } from '#scripts/wiki.js'

const ROOT = 'docs/wiki'
const repo = process.env.GITHUB_REPOSITORY ?? 'cgaube/local-env'
const target = process.argv[2]
if (!target) {
  console.error('Usage: wiki-sync.ts <wiki checkout> | --check')
  process.exit(1)
}

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })

const files = Object.fromEntries(
  listFiles(ROOT).map((path) => [
    relative(ROOT, path),
    readFileSync(path, 'utf8'),
  ]),
)

let pages: Record<string, string>
try {
  pages = buildWiki(files, {
    root: ROOT,
    blobUrl: `https://github.com/${repo}/blob/main`,
    exists: existsSync,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

if (target === '--check') {
  console.log(`${Object.keys(pages).length - 2} wiki pages, no problem`)
  process.exit(0)
}

for (const entry of readdirSync(target)) {
  if (entry.endsWith('.md')) rmSync(join(target, entry))
}
for (const [name, content] of Object.entries(pages)) {
  writeFileSync(join(target, name), content)
}
console.log(`Wrote ${Object.keys(pages).length - 2} wiki pages to ${target}`)
