import { spinner } from '@clack/prompts'
import { basename } from 'path'
import { styleText } from 'node:util'
import { logger } from '#cli/utils/logger.js'

// Draws an ansible-playbook run like the rest of the CLI, from the events of
// Ansible's ansible.posix.jsonl callback (one JSON object a line): a group
// per role, a spinner while each task runs, then a line with its result. A
// task with a loop has a line for each item under it, as Ansible's own
// output does: the callback sends no event per item, only their results.

type ItemResult = {
  item?: unknown
  // loop_control.label, else the item
  _ansible_item_label?: unknown
  changed?: boolean
  failed?: boolean
  skipped?: boolean
  skip_reason?: string
  // Set on a failed item since ansible-core 2.19, which drops `failed` there
  exception?: unknown
  msg?: unknown
  stderr?: string
}

type HostResult = {
  changed?: boolean
  msg?: unknown
  stderr?: string
  // A task with a loop: one result for each item
  results?: ItemResult[]
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
  // The roles whose task failed as sudo wanted a password, as shown
  needPassword: string[]
}

// What sudo says when it has no password (Ansible runs it with -n then)
const NO_PASSWORD = /a password is required/

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

// An empty one (a command's) is none
const shortMessage = (msg: unknown) =>
  typeof msg === 'string' &&
  msg.trim() !== '' &&
  !msg.includes('\n') &&
  msg.length <= MESSAGE_LENGTH
    ? msg
    : null

// The longest label shown for an item: a whole dict is cut
const LABEL_LENGTH = 60

const itemLabel = (item: ItemResult) => {
  const label = item._ansible_item_label ?? item.item
  const text = typeof label === 'string' ? label : JSON.stringify(label)
  return text.length > LABEL_LENGTH
    ? `${text.slice(0, LABEL_LENGTH - 1)}…`
    : text
}

const itemState = (item: ItemResult) =>
  item.failed === true || item.exception !== undefined
    ? 'failed'
    : item.skipped === true || item.skip_reason !== undefined
      ? 'skipped'
      : item.changed
        ? 'changed'
        : 'ok'

// The error of a failed item, or of a failed task: its message, then the
// end of its stderr
const failureDetails = (result: { msg?: unknown; stderr?: string }) => {
  const message = typeof result.msg === 'string' ? result.msg : null
  const stderr = result.stderr?.trim().split('\n').slice(-FAILURE_TAIL)
  return [message, ...(stderr ?? [])].filter((line): line is string =>
    Boolean(line),
  )
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

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

// labels: the name to show of each role, by its Ansible name (the catalog's
// labels). A role without one (from Galaxy) shows its Ansible name.
export const renderPlaybook = async (
  lines: AsyncIterable<string>,
  labels: ReadonlyMap<string, string> = new Map(),
): Promise<PlaybookSummary> => {
  const summary: PlaybookSummary = {
    ok: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    needPassword: [],
  }
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

  // A line for each item of a loop, under its task, as Ansible shows them
  const items = (results: ItemResult[]) => {
    const failures: string[] = []
    for (const item of results) {
      const label = itemLabel(item)
      switch (itemState(item)) {
        case 'failed': {
          logger.log(`  ${styleText('red', '✗')} ${styleText('red', label)}`)
          const details = failureDetails(item)
          if (details.length > 0) {
            logger.log(
              styleText('red', details.map((line) => `    ${line}`).join('\n')),
            )
          }
          failures.push(...details)
          break
        }
        case 'skipped':
          result(
            `  ${styleText('dim', '↷')}`,
            styleText('dim', label),
            'skipped',
          )
          break
        case 'changed':
          result(
            `  ${styleText('green', '●')}`,
            label,
            shortMessage(item.msg) ?? 'changed',
          )
          break
        default:
          result(
            `  ${styleText('dim', '✓')}`,
            styleText('dim', label),
            shortMessage(item.msg),
          )
      }
    }
    return failures
  }

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
        logger.group(labels.get(role) ?? role)
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
      case 'v2_runner_on_ok': {
        stopProgress()
        // A loop: the count, then its items, in place of Ansible's "All
        // items completed"
        const loop = host.results ? plural(host.results.length, 'item') : null
        if (host.changed) {
          summary.changed++
          result(
            styleText('green', '●'),
            task,
            loop ?? shortMessage(host.msg) ?? 'changed',
          )
        } else {
          summary.ok++
          result(
            styleText('dim', '✓'),
            styleText('dim', task),
            loop ?? shortMessage(host.msg),
          )
        }
        if (host.results) items(host.results)
        break
      }
      case 'v2_runner_on_skipped':
        stopProgress()
        summary.skipped++
        result(styleText('dim', '↷'), styleText('dim', task), 'skipped')
        break
      case 'v2_runner_on_failed':
      case 'v2_runner_on_unreachable': {
        stopProgress()
        summary.failed++
        result(
          styleText('red', '✗'),
          styleText('red', task),
          host.results ? plural(host.results.length, 'item') : null,
        )
        // A loop: the items say which failed and why, in place of
        // Ansible's "One or more items failed"
        let details: string[]
        if (host.results) {
          details = items(host.results)
        } else {
          details = failureDetails(host)
          if (details.length > 0) {
            logger.log(styleText('red', details.join('\n')))
          }
        }
        const role = group ? (labels.get(group) ?? group) : task
        if (
          details.some((detail) => NO_PASSWORD.test(detail)) &&
          !summary.needPassword.includes(role)
        ) {
          summary.needPassword.push(role)
        }
        break
      }
    }
  }
  stopProgress()
  return summary
}
