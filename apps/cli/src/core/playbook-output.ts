import { spinner } from '@clack/prompts'
import { basename } from 'path'
import { styleText } from 'node:util'
import { logger } from '#cli/utils/logger.js'

// Draws an ansible-playbook run like the rest of the CLI, from the events of
// Ansible's ansible.posix.jsonl callback (one JSON object a line): a group
// per role, a spinner while each task runs, then a line with its result.

type HostResult = {
  changed?: boolean
  msg?: unknown
  stderr?: string
}

type PlaybookEvent = {
  _event: string
  task?: { name?: string }
  hosts?: Record<string, HostResult>
}

export type PlaybookSummary = {
  ok: number
  changed: number
  skipped: number
  failed: number
}

// Lines of a failed task's stderr shown
const FAILURE_TAIL = 10
// A longer message (a whole command output) isn't shown on the result line
const MESSAGE_LENGTH = 80

// "../sources/acme/ansible/git : Install git" -> the role and the task
const splitTaskName = (name: string) => {
  const separator = name.indexOf(' : ')
  return separator === -1
    ? { role: null, task: name }
    : {
        role: basename(name.slice(0, separator)),
        task: name.slice(separator + 3),
      }
}

const shortMessage = (msg: unknown) =>
  typeof msg === 'string' && !msg.includes('\n') && msg.length <= MESSAGE_LENGTH
    ? msg
    : null

const parse = (line: string): PlaybookEvent | null => {
  try {
    const event = JSON.parse(line)
    return typeof event?._event === 'string' ? event : null
  } catch {
    // Not an event: a stray line of output
    return null
  }
}

// Same check as utils/task.ts: clack can't redraw without a terminal width
const canRedraw = () =>
  process.stdout.isTTY === true && (process.stdout.columns ?? 0) > 0

export const renderPlaybook = async (
  lines: AsyncIterable<string>,
): Promise<PlaybookSummary> => {
  const summary: PlaybookSummary = { ok: 0, changed: 0, skipped: 0, failed: 0 }
  let group: string | null = null
  let task: string | null = null
  let progress: ReturnType<typeof spinner> | null = null

  const stopProgress = () => {
    progress?.clear()
    progress = null
  }

  const result = (mark: string, text: string, detail: string | null) =>
    logger.log(
      `${mark} ${text}${detail ? `  ${styleText('dim', detail)}` : ''}`,
    )

  for await (const line of lines) {
    const event = parse(line)
    if (!event) continue

    if (
      event._event === 'v2_playbook_on_task_start' ||
      event._event === 'v2_playbook_on_handler_task_start'
    ) {
      stopProgress()
      const { role, task: name } = splitTaskName(event.task?.name ?? '')
      // Ansible's own step before the roles: nothing to show
      task = name === 'Gathering Facts' ? null : name
      if (!task) continue
      if (role && role !== group) {
        group = role
        logger.group(role)
      }
      if (canRedraw()) {
        progress = spinner({ withGuide: false })
        progress.start(task)
      }
      continue
    }

    const [host] = Object.values(event.hosts ?? {})
    if (!host || !task) continue
    switch (event._event) {
      case 'v2_runner_on_ok':
        stopProgress()
        if (host.changed) {
          summary.changed++
          result(
            styleText('green', '●'),
            task,
            shortMessage(host.msg) ?? 'changed',
          )
        } else {
          summary.ok++
          result(
            styleText('dim', '✓'),
            styleText('dim', task),
            shortMessage(host.msg),
          )
        }
        break
      case 'v2_runner_on_skipped':
        stopProgress()
        summary.skipped++
        result(styleText('dim', '↷'), styleText('dim', task), 'skipped')
        break
      case 'v2_runner_on_failed':
      case 'v2_runner_on_unreachable': {
        stopProgress()
        summary.failed++
        result(styleText('red', '✗'), styleText('red', task), null)
        const message = typeof host.msg === 'string' ? host.msg : null
        const stderr = host.stderr?.trim().split('\n').slice(-FAILURE_TAIL)
        const details = [message, ...(stderr ?? [])].filter(Boolean)
        if (details.length > 0) logger.log(styleText('red', details.join('\n')))
        break
      }
    }
  }
  stopProgress()
  return summary
}
