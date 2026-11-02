import { styleText } from 'node:util'

// The intro of every command: the logo, then the title in a gradient from
// Dracula purple to pink (draculatheme.com)

const LOGO = '⬢'
const PURPLE = [189, 147, 249]
const PINK = [255, 121, 198]

const reset = '\x1b[0m'
const color = ([r, g, b]: number[]) => `\x1b[38;2;${r};${g};${b}m`

// 24-bit colors: announced by COLORTERM, or known to these terminals
const TRUECOLOR_TERMINALS = ['iTerm.app', 'WezTerm', 'vscode', 'ghostty']
const hasTruecolor = () =>
  /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? '') ||
  TRUECOLOR_TERMINALS.includes(process.env.TERM_PROGRAM ?? '')

const mix = (t: number) =>
  PURPLE.map((value, i) => Math.round(value + (PINK[i]! - value) * t))

export const brandTitle = (title: string) => {
  if (process.env.NO_COLOR) return `${LOGO} ${title}`
  // Other terminals: plain purple, from their own palette
  if (!hasTruecolor()) return styleText(['magenta', 'bold'], `${LOGO} ${title}`)

  const chars = [...title]
  const painted = chars
    .map((char, i) => {
      const t = chars.length > 1 ? i / (chars.length - 1) : 0
      return `${color(mix(t))}${char}`
    })
    .join('')
  return `${color(PURPLE)}${LOGO}${reset} \x1b[1m${painted}${reset}`
}
