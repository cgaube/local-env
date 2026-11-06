// What the dashboard agent (apps/cli/src/agent/server.ts) and the page say to
// each other over /api/terminal, which the dashboard server pipes through.
// No imports: the web app loads it too.

export const AGENT_COMMANDS = ['install', 'update'] as const
export type AgentCommand = (typeof AGENT_COMMANDS)[number]

export type RunState = {
  command: AgentCommand
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
  | { type: 'start'; command: AgentCommand; cols?: number; rows?: number }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// To the page, as JSON text; the pty's output comes as binary frames. A
// state with replay: true is sent on connect, before the run's output so
// far.
export type ServerMessage =
  | { type: 'state'; run: RunState | null; replay: boolean }
  | { type: 'error'; message: string }
