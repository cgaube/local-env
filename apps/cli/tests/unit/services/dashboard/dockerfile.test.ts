import { readFileSync } from 'fs'
import { join } from 'path'

// The dashboard's image copies its files one by one (services/dashboard/
// Dockerfile). A file that server.ts imports, and that the list misses, only
// fails when the container starts: the tests run server.ts from the
// checkout. Tests run from the root.
const DIR = join(process.cwd(), 'services/dashboard')

// The relative imports of a file that stay at run time: not `import type`
const runtimeImports = (file: string) =>
  [
    ...readFileSync(join(DIR, file), 'utf8').matchAll(
      /^import\s+(?!type\s)[^'"]*?from\s+'\.\/([^']+)'/gm,
    ),
  ].map(([, path]) => path!.replace(/\.js$/, '.ts'))

describe('services/dashboard/Dockerfile', () => {
  test('copies every file that server.ts needs, theirs too', () => {
    const copied = new Set(
      /^COPY ((?:\S+\.ts\s+)+)\.\/$/m
        .exec(readFileSync(join(DIR, 'Dockerfile'), 'utf8'))![1]!
        .trim()
        .split(/\s+/),
    )
    const needed = new Set<string>()
    const queue = ['server.ts']
    for (let file = queue.shift(); file; file = queue.shift()) {
      if (needed.has(file)) continue
      needed.add(file)
      queue.push(...runtimeImports(file))
    }

    expect([...needed].filter((file) => !copied.has(file))).toEqual([])
  })
})
