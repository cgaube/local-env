// Runs the CLI as a user would: a child process, in a temporary home folder,
// with fake external binaries, a fake Dockhand and scripted answers to its
// questions. Every e2e test starts here:
//
//   await using cli = await createCli()
//   cli.bin.on('docker', ['compose', 'down'])
//   const result = await cli.run(['stop'])
//
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createFakeBin } from './fake-bin.js'
import { type DockhandState, startFakeDockhand } from './fake-dockhand.js'
import type { AskedQuestion, FakeAnswer } from './fake-prompts.js'
import { createSourceRepo, GIT_ENV } from './factories/source.js'
import { createHome } from './home.js'

const ROOT = resolve(import.meta.dir, '../..')
const FAKE_PROMPTS_PLUGIN = join(import.meta.dir, 'fake-prompts-plugin.ts')

// LOCAL_ENV_BIN=./local-env runs the compiled binary instead of the sources,
// which also checks the files it embeds. Its prompts can't be faked.
export const COMPILED = Boolean(process.env.LOCAL_ENV_BIN)

const cliCommand = () =>
  COMPILED
    ? [resolve(ROOT, '../..', process.env.LOCAL_ENV_BIN!)]
    : [
        process.execPath,
        '--preload',
        FAKE_PROMPTS_PLUGIN,
        join(ROOT, 'src/main.ts'),
      ]

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
  // stdout then stderr, without colors, with temporary paths as <HOME>,
  // <TMP>: stable enough for snapshots
  output: string
  // The questions the CLI asked, in order
  questions: string[]
}

export const createCli = async ({
  dockhand: seed,
}: { dockhand?: Partial<DockhandState> } = {}) => {
  // realpath: macOS's /var/folders is a link to /private/var/folders, which
  // git prints
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'local-env-test-')))
  const home = createHome(join(root, 'home'))
  const bin = createFakeBin(join(root, 'fake'))
  const dockhand = startFakeDockhand(seed)
  const prompts = join(root, 'prompts')
  mkdirSync(prompts)
  // The CLI's temporary files, apart from other tests running at the same time
  const tmp = join(root, 'tmp')
  mkdirSync(tmp)

  const normalize = (text: string) =>
    Bun.stripANSI(text)
      .replaceAll(home.dir, '<HOME>')
      .replaceAll(root, '<TMP>')
      .trimEnd()

  // Answers the CLI's questions in order. A question without an answer, or
  // an answer left over, fails the test.
  const run = async (
    args: string[],
    {
      answers = [],
      env = {},
    }: { answers?: FakeAnswer[]; env?: Record<string, string> } = {},
  ): Promise<CliResult> => {
    if (COMPILED && answers.length > 0) {
      throw new Error('Answers need the sources: skip this test with COMPILED')
    }
    const log = join(prompts, 'questions.jsonl')
    rmSync(log, { force: true })
    writeFileSync(join(prompts, 'answers.json'), JSON.stringify(answers))

    const child = Bun.spawn([...cliCommand(), ...args], {
      cwd: root,
      // Built from scratch: nothing leaks in from the developer's shell
      env: {
        PATH: bin.path,
        HOME: join(root, 'user'),
        TMPDIR: tmp,
        NO_COLOR: '1',
        LOCAL_ENV_HOME: home.dir,
        LOCAL_ENV_DOCKHAND_URL: dockhand.url,
        FAKE_PROMPTS_DIR: prompts,
        ...bin.env,
        ...GIT_ENV,
        ...env,
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const output = normalize([stdout, stderr].filter(Boolean).join('\n'))

    const asked: AskedQuestion[] = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : []
    const failed = asked.find((question) => question.error)
    if (failed) {
      throw new Error(
        `Unexpected question: ${failed.message}\n${failed.error}\n\n${output}`,
      )
    }
    if (asked.length < answers.length) {
      const left = answers.slice(asked.length).map(({ ask }) => ask)
      throw new Error(`Never asked: ${left.join(' | ')}\n\n${output}`)
    }
    return {
      exitCode,
      stdout,
      stderr,
      output,
      questions: asked.map((question) => question.message),
    }
  }

  return {
    root,
    home,
    bin,
    dockhand,
    run,
    // A git repo shaped like a source, outside the home folder
    createSource: (
      name: string,
      options?: Parameters<typeof createSourceRepo>[1],
    ) => createSourceRepo(join(root, 'repos', name), options),
    [Symbol.asyncDispose]: async () => {
      await dockhand.stop()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export type Cli = Awaited<ReturnType<typeof createCli>>
