// `bun run test`: runs `bun test` with the given arguments, then lists the
// slowest tests. bun test has no such report: its JUnit file has the times.
// Bun keeps one --reporter, so pass `--dots` for dots, not `--reporter dot`.
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { styleText } from 'node:util'

const SLOWEST = 5

const dir = mkdtempSync(join(tmpdir(), 'local-env-junit-'))
const report = join(dir, 'junit.xml')

const child = Bun.spawn(
  [
    process.execPath,
    'test',
    // One process per file: e2e tests wait on child processes
    '--parallel',
    '--reporter=junit',
    `--reporter-outfile=${report}`,
    ...process.argv.slice(2),
  ],
  { stdio: ['inherit', 'inherit', 'inherit'] },
)
const exitCode = await child.exited

const decode = (text: string) =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const attribute = (tag: string, name: string) =>
  decode(new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1] ?? '')

try {
  const tests = [
    ...readFileSync(report, 'utf8').matchAll(/<testcase\b[^>]*>/g),
  ].map(([tag]) => ({
    name: [attribute(tag, 'classname'), attribute(tag, 'name')]
      .filter(Boolean)
      .join(' > '),
    location: `${attribute(tag, 'file')}:${attribute(tag, 'line')}`,
    ms: Number(attribute(tag, 'time')) * 1000,
  }))
  const slowest = tests.sort((a, b) => b.ms - a.ms).slice(0, SLOWEST)
  if (slowest.length > 0) {
    // Unit tests take well under a millisecond
    const format = (ms: number) => ms.toFixed(ms < 10 ? 2 : 0)
    const width = Math.max(...slowest.map(({ ms }) => format(ms).length))
    console.log(`\n${SLOWEST} slowest tests:`)
    // Concurrent tests share the CPU: each time includes waiting for it
    console.log(
      styleText(
        'dim',
        '  Times overlap. For each test on its own: bun run test --max-concurrency=1',
      ),
    )
    for (const { name, location, ms } of slowest) {
      console.log(
        `  ${`${format(ms).padStart(width)} ms`}  ${name}  ${styleText('dim', location)}`,
      )
    }
  }
} catch {
  // No report: bun test failed before running anything, and said why
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.exit(exitCode)
