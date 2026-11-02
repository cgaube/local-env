import { spinner } from '@clack/prompts'
import { execa } from 'execa'
import { logger } from './logger.js'

// Lines of output shown when a task fails
const FAILURE_TAIL = 20

// clack redraws using the terminal width; a zero width (pipes, some
// pseudo-terminals) breaks its line maths
const canRedraw = () =>
  process.stdout.isTTY === true && (process.stdout.columns ?? 0) > 0

// Runs a noisy command (compose, git) behind a spinner. On success it leaves
// one line in the current group; on failure, the end of the output.
export const runTask = async (
  title: string,
  command: string,
  args: string[],
  { done = title, env }: { done?: string; env?: Record<string, string> } = {},
) => {
  // No guide line above the spinner: it would stay behind as an empty line
  // once the spinner is cleared
  const progress = canRedraw() ? spinner({ withGuide: false }) : null
  progress?.start(title)

  const child = execa(command, args, { all: true, reject: false, env })
  const output: string[] = []
  for await (const line of child.iterable({ from: 'all' })) {
    output.push(line)
  }
  const result = await child
  progress?.clear()

  if (result.exitCode !== 0) {
    logger.error(`${title} failed:`)
    logger.log(output.slice(-FAILURE_TAIL).join('\n'))
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.exitCode}`,
    )
  }
  logger.success(done)
  return result
}
