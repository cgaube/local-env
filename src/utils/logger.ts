import { log, note } from '@clack/prompts'
import { styleText } from 'node:util'

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// True right after the command's title: the next line keeps a gap below it
let afterIntro = false
export const markIntro = () => {
  afterIntro = true
}

// A line under the current group, on clack's guide line without an icon
const line = (text: string) => {
  log.message(text, { spacing: afterIntro ? 1 : 0 })
  afterIntro = false
}

// Shared CLI logger. Output is organised in groups: one titled header per
// phase, then plain lines; only warnings and errors are marked.
export const logger = {
  group: (title: string) => {
    log.step(title)
    afterIntro = false
  },
  info: (message: string) => line(styleText('dim', message)),
  success: (message: string) => line(message),
  warn: (message: string) => line(styleText('yellow', `▲ ${message}`)),
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
