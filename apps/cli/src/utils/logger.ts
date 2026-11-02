import { log, note, outro } from '@clack/prompts'
import { styleText } from 'node:util'
import {
  type CalloutLevel,
  type CalloutOptions,
  formatCallout,
} from './callout.js'

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// True right after the command's title or an alert: the next line keeps a
// gap below it
let gapBefore = false
export const markIntro = () => {
  gapBefore = true
}

// Closed by a command that hands over to another process (update, once it
// upgraded local-env): main.ts then leaves the frame alone
let frameClosed = false
export const closeFrame = (message: string) => {
  // main.ts frames only a terminal's output
  if (process.stdout.isTTY) outro(message)
  else log.message(message)
  frameClosed = true
}
export const isFrameClosed = () => frameClosed

// A line under the current group, on clack's guide line without an icon
const line = (text: string) => {
  log.message(text, { spacing: gapBefore ? 1 : 0 })
  gapBefore = false
}

// Shared CLI logger. Output is organised in groups: one titled header per
// phase, then plain lines; only warnings and errors are marked.
export const logger = {
  group: (title: string) => {
    log.step(title)
    gapBefore = false
  },
  info: (message: string) => line(styleText('dim', message)),
  success: (message: string) => line(message),
  warn: (message: string) => line(styleText('yellow', `▲ ${message}`)),
  // A callout that must not be missed (utils/callout.ts): the first line is
  // the title. A gap separates it from what comes next.
  callout: (
    level: CalloutLevel,
    text: string,
    options?: Pick<CalloutOptions, 'tinted' | 'padded'>,
  ) => {
    process.stdout.write(`${formatCallout(level, text, options).join('\n')}\n`)
    gapBefore = true
  },
  error: (message: string, error?: unknown) =>
    line(
      styleText(
        'red',
        `✗ ${error === undefined ? message : `${message} ${describe(error)}`}`,
      ),
    ),
  log: (message: string) => line(message),
  // A dim footer, set apart from the lines above
  hint: (message: string) => log.message(styleText('dim', message)),
  // The first line is the title
  box: (text: string) => {
    const [title, ...lines] = text.split('\n')
    note(lines.join('\n'), title)
  },
}
