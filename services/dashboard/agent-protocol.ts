// What the dashboard agent (apps/cli/src/agent/server.ts) and the page say to
// each other over /api/terminal, which the dashboard server pipes through.
// No imports: the web app loads it too.

export const AGENT_COMMANDS = ['install', 'update', 'deploy'] as const
export type AgentCommand = (typeof AGENT_COMMANDS)[number]

// A template of the sources: <source>/<folder>
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

// The arguments of a run, after the command: deploy takes a template, and
// asks nothing first (the page's Deploy button was the question). null when
// the command can't take what was given: the page never runs anything else.
export const runArguments = (
  command: AgentCommand,
  template: unknown,
): string[] | null => {
  if (command !== 'deploy') return template === undefined ? [] : null
  return typeof template === 'string' && TEMPLATE_ID.test(template)
    ? [template, '--yes']
    : null
}

export type RunState = {
  command: AgentCommand
  // deploy's template, else null
  template: string | null
  status: 'running' | 'exited'
  exitCode: number | null
  startedAt: string
}

// GET /status of the agent
export type AgentStatus = {
  version: string
  run: RunState | null
}

// The `agent` topic of /api/events: not available when the agent isn't
// running (`local-env start` starts it)
export type AgentState =
  | { available: true; version: string; run: RunState | null }
  | { available: false; version: null; run: null }

// From the page, as JSON text
export type ClientMessage =
  | {
      type: 'start'
      command: AgentCommand
      // deploy only: the template to deploy
      template?: string
      cols?: number
      rows?: number
    }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// To the page, as JSON text; the pty's output comes as binary frames. A
// state with replay: true is sent on connect, before the run's output so
// far.
export type ServerMessage =
  | { type: 'state'; run: RunState | null; replay: boolean }
  | { type: 'error'; message: string }

// GET /logins of the agent: every login of the sources, its state checked
// on the Mac, where the sessions of AWS and Vault are. Never a secret.
export type LoginRow = {
  type: string
  // Its name in the manifest of the first source that declares it
  name: string
  // What the user reads: ghcr.io, AWS 123456789012 (Dev)
  title: string
  sources: string[]
  // not-asked: a registry the user chose not to be asked about again;
  // unknown: Dockhand cannot be reached
  state: 'logged-in' | 'logged-out' | 'no-cli' | 'not-asked' | 'unknown'
  // As whom, or why not
  detail: string | null
  // What to run in a terminal, when the state is not logged-in
  command: string | null
  // The source's help: who to ask for access
  help: string | null
}

export type LoginsReport = { logins: LoginRow[] }

// GET /api/logins of the dashboard: not available when the agent isn't
// running
export type LoginsResponse =
  | { available: true; logins: LoginRow[] }
  | { available: false }
