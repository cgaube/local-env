import { cancel, log, note, outro, S_BAR, S_STEP_ACTIVE } from '@clack/prompts'
import { styleText } from 'node:util'
import {
  type CalloutLevel,
  type CalloutOptions,
  formatCallout,
} from '#cli/utils/callout.js'

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
// Closed in red by a command stopped halfway (Ctrl-C): main.ts adds nothing
export const cancelFrame = (message: string) => {
  if (process.stdout.isTTY) cancel(message)
  else log.message(message)
  frameClosed = true
}
export const isFrameClosed = () => frameClosed
// Ends the output with a callout that says how the command went: the frame
// closes under it, without main.ts's "Done"
export const closeFrameWithCallout = (
  level: CalloutLevel,
  text: string,
  options?: Pick<CalloutOptions, 'tinted' | 'padded'>,
) => {
  // Its own corner closes the frame: main.ts frames only a terminal's output
  const closing = process.stdout.isTTY === true
  process.stdout.write(
    `${formatCallout(level, text, { ...options, closing }).join('\n')}\n${closing ? '\n' : ''}`,
  )
  frameClosed = true
}

// Where another program writes in the terminal, between two of these: the
// guide line goes on, dotted
const dottedGuide = () =>
  log.message('', { spacing: 0, symbol: styleText('dim', '┊') })

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
  // A step of its own that went well, with a green ✓ in place of clack's
  // symbol, like the tasks' lines: one line, not a group
  step: (message: string) => {
    log.message(message, { symbol: styleText('green', '✓') })
    gapBefore = false
  },
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
  // Before another program takes the terminal (a vendor's login): what it
  // does and its command, then the guide line goes on dotted, so that its own
  // lines read as outside the frame. takeBack() dots it again after them.
  handOver: (title: string, command: string) => {
    process.stdout.write(
      [
        styleText('gray', S_BAR),
        `${styleText('cyan', S_STEP_ACTIVE)}  ${title}`,
        `${styleText('gray', S_BAR)}  ${styleText('dim', command)}`,
        '',
      ].join('\n'),
    )
    dottedGuide()
    gapBefore = false
  },
  takeBack: () => {
    dottedGuide()
    gapBefore = false
  },
  // A dim footer, set apart from the lines above
  hint: (message: string) => log.message(styleText('dim', message)),
  // The first line is the title
  box: (text: string) => {
    const [title, ...lines] = text.split('\n')
    note(lines.join('\n'), title)
  },
}
