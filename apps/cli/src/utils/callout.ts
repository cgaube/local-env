import {
  S_BAR,
  S_BAR_END,
  S_ERROR,
  S_INFO,
  S_SUCCESS,
  S_WARN,
} from '@clack/prompts'
import { stripVTControlCharacters, styleText } from 'node:util'

// A callout on clack's guide line: the level's symbol and a bold title, then
// the text after a bar of the level's color, wrapped to the terminal.
//
//   ▲  Outdated core services
//   ┃
//   ┃  They run an older version of local-env: dashboard.
//   ┃  Run `local-env start` to update them.
//   ┃
//
// A title alone that closes the frame is two lines: `◆  All logins work`,
// then clack's thin corner, └.

export type CalloutLevel = 'info' | 'success' | 'warn' | 'error'

export type CalloutOptions = {
  // The text in the title's color, dimmed: the whole callout in one color
  tinted?: boolean
  // A bar line under the title and after the text. Off: a compact callout.
  padded?: boolean
  // The last callout of the output: it ends with the bar's corner, in its
  // color, which closes the frame
  closing?: boolean
  columns?: number
}

// clack's own, as its log.info, log.success, log.warn and log.error
const LEVELS = {
  info: { symbol: S_INFO, color: 'blue' },
  success: { symbol: S_SUCCESS, color: 'green' },
  warn: { symbol: S_WARN, color: 'yellow' },
  error: { symbol: S_ERROR, color: 'red' },
} as const

const BAR = '┃'
// The bar's corner, as thick: closes the frame like clack's └
const CORNER = '┗'
// The symbol or bar, then two spaces, as clack's lines
const INDENT = 3

const width = (text: string) => stripVTControlCharacters(text).length

// A line in words that fit `max` characters. A word longer than that stays
// whole: a URL is still copied in one piece.
const wrap = (line: string, max: number) => {
  const lines: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    if (current && width(`${current} ${word}`) > max) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  // A space at the end of the line would wrap to an empty one
  return [...lines, current].map((part) => part.trimEnd())
}

// The lines to print, after a gap on the guide line. The first line of `text`
// is the title.
export const formatCallout = (
  level: CalloutLevel,
  text: string,
  {
    tinted = false,
    padded = true,
    closing = false,
    columns = process.stdout.columns || 80,
  }: CalloutOptions = {},
) => {
  const { symbol, color } = LEVELS[level]
  const [title = '', ...lines] = text.split('\n')
  const max = Math.max(columns - INDENT, 20)
  return [
    styleText('gray', S_BAR),
    ...wrap(title, max).map(
      (part, index) =>
        `${index === 0 ? styleText(color, symbol) : styleText('gray', S_BAR)}  ${styleText([color, 'bold'], part)}`,
    ),
    // A bar line around the text when padded: under the title and after it
    ...(lines.length > 0
      ? [
          ...(padded ? [styleText(color, BAR)] : []),
          ...lines
            .flatMap((line) => wrap(line, max))
            .map(
              (part) =>
                `${styleText(color, BAR)}  ${tinted ? styleText([color, 'dim'], part) : part}`,
            ),
        ]
      : []),
    // A bar line after the text, but not between a title alone and the
    // corner: an empty line there
    ...(padded && (lines.length > 0 || !closing)
      ? [styleText(color, BAR)]
      : []),
    // After the padding: the corner closes the frame. Thin under a title
    // alone, as clack's: there is no thick bar to end
    ...(closing
      ? [styleText(color, lines.length > 0 ? CORNER : S_BAR_END)]
      : []),
  ]
}
