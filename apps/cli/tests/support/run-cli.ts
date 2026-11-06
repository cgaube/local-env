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
import {
  createFakeBin,
  type FakedCommand,
} from '#cli-tests/support/fake-bin.js'
import {
  type DockhandState,
  startFakeDockhand,
} from '#cli-tests/support/fake-dockhand.js'
import type {
  AskedQuestion,
  FakeAnswer,
} from '#cli-tests/support/fake-prompts.js'
import {
  createSourceRepo,
  GIT_ENV,
} from '#cli-tests/support/factories/source.js'
import { createHome } from '#cli-tests/support/home.js'

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

// A port nothing listens on, for now
const freePort = () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const { port } = server
  server.stop(true)
  return port!
}

// The agent a test's `start` left running
const killAgent = (homeDir: string) => {
  try {
    const { pid } = JSON.parse(
      readFileSync(join(homeDir, 'volumes/agent/agent.json'), 'utf8'),
    )
    process.kill(pid, 'SIGKILL')
  } catch {
    // None, or gone already
  }
}

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
  // `start` spawns the dashboard agent: each CLI on its own port
  const agentPort = freePort()

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
      stdin,
      signal,
    }: {
      answers?: FakeAnswer[]
      env?: Record<string, string>
      // Piped to the CLI, e.g. a token for --password-stdin
      stdin?: string
      // Sent to the CLI once this run called this binary: Ctrl-C halfway
      signal?: { send: NodeJS.Signals; after: FakedCommand }
    } = {},
  ): Promise<CliResult> => {
    if (COMPILED && answers.length > 0) {
      throw new Error('Answers need the sources: skip this test with COMPILED')
    }
    const log = join(prompts, 'questions.jsonl')
    rmSync(log, { force: true })
    writeFileSync(join(prompts, 'answers.json'), JSON.stringify(answers))

    const callsBefore = signal ? bin.calls(signal.after).length : 0
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
        LOCAL_ENV_AGENT_PORT: String(agentPort),
        // Nothing listens there: the new version check fails at once, and
        // never reaches GitHub. Tests of the check pass their own.
        LOCAL_ENV_FORMULA_URL: 'http://127.0.0.1:9/',
        FAKE_PROMPTS_DIR: prompts,
        ...bin.env,
        ...GIT_ENV,
        ...env,
      },
      stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const done = Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (signal) {
      const deadline = Date.now() + 10_000
      while (
        bin.calls(signal.after).length === callsBefore &&
        Date.now() < deadline
      ) {
        await Bun.sleep(20)
      }
      child.kill(signal.send)
    }
    const [stdout, stderr, exitCode] = await done
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
    // The CLI's TMPDIR
    tmp,
    home,
    bin,
    dockhand,
    run,
    // A git repo shaped like a source, outside the home folder
    createSource: (
      name: string,
      options?: Parameters<typeof createSourceRepo>[1],
    ) => createSourceRepo(join(root, 'repos', name), options),
    agentPort,
    [Symbol.asyncDispose]: async () => {
      killAgent(home.dir)
      await dockhand.stop()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export type Cli = Awaited<ReturnType<typeof createCli>>
