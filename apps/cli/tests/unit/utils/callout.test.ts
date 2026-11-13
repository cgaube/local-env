import { stripVTControlCharacters, styleText } from 'node:util'
import { formatCallout } from '#cli/utils/callout.js'

const plain = (lines: string[]) => lines.map(stripVTControlCharacters)

describe('formatCallout', () => {
  test('a title after the level symbol, the text after a bar', () => {
    expect(
      plain(
        formatCallout('warn', 'Outdated\nRun `local-env start`.', {
          columns: 80,
        }),
      ),
    ).toEqual(['│', '▲  Outdated', '┃', '┃  Run `local-env start`.', '┃'])
  })

  test('can leave out the padding around the text', () => {
    expect(
      plain(
        formatCallout('warn', 'Outdated\nRun `local-env start`.', {
          padded: false,
          columns: 80,
        }),
      ),
    ).toEqual(['│', '▲  Outdated', '┃  Run `local-env start`.'])
  })

  test('ends with the corner that closes the frame, in its color', () => {
    const closing = (padded: boolean) =>
      formatCallout('success', 'Installed 4 tools\n4 unchanged', {
        closing: true,
        padded,
        columns: 80,
      })

    expect(plain(closing(true))).toEqual([
      '│',
      '◆  Installed 4 tools',
      '┃',
      '┃  4 unchanged',
      '┃',
      '┗',
    ])
    expect(plain(closing(false))).toEqual([
      '│',
      '◆  Installed 4 tools',
      '┃  4 unchanged',
      '┗',
    ])
    expect(closing(true).at(-1)).toBe(styleText('green', '┗'))
  })

  test('a title alone has no empty line under it', () => {
    expect(plain(formatCallout('success', 'All set', { columns: 80 }))).toEqual(
      ['│', '◆  All set', '┃'],
    )
  })

  test('closes the frame right under a title alone, with a thin corner', () => {
    expect(
      plain(
        formatCallout('success', 'All set', { columns: 80, closing: true }),
      ),
    ).toEqual(['│', '◆  All set', '└'])
  })

  test("has each level's own symbol", () => {
    const symbol = (level: Parameters<typeof formatCallout>[0]) =>
      plain(formatCallout(level, 'Title', { columns: 80 }))[1]?.[0]

    expect(
      ['info', 'success', 'warn', 'error'].map((level) =>
        symbol(level as Parameters<typeof formatCallout>[0]),
      ),
    ).toEqual(['●', '◆', '▲', '■'])
  })

  test('can tint the text with the title color, dimmed', () => {
    // Colors are off without a terminal
    const noColor = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = '1'
    try {
      const text = (tinted: boolean) =>
        formatCallout('warn', 'Title\nRun it', { tinted, columns: 80 })[3]
      const dimYellow = styleText(['yellow', 'dim'], 'Run it')

      expect(dimYellow).not.toBe('Run it')
      expect(text(true)).toContain(dimYellow)
      expect(text(false)).not.toContain(dimYellow)
    } finally {
      if (noColor === undefined) delete process.env.FORCE_COLOR
      else process.env.FORCE_COLOR = noColor
    }
  })

  test('wraps the text to the terminal, word by word', () => {
    expect(
      plain(
        formatCallout('info', 'Title\nalpha beta gamma delta epsilon', {
          columns: 23,
        }),
      ),
    ).toEqual([
      '│',
      '●  Title',
      '┃',
      '┃  alpha beta gamma',
      '┃  delta epsilon',
      '┃',
    ])
  })

  test('leaves no space at the end of a line', () => {
    expect(
      plain(
        formatCallout('info', 'Title\nend of a sentence. ', { columns: 80 }),
      ),
    ).toEqual(['│', '●  Title', '┃', '┃  end of a sentence.', '┃'])
  })

  test('keeps a word longer than the line whole', () => {
    const url = `https://local-env.dev.test/${'x'.repeat(40)}`

    expect(
      plain(formatCallout('info', `Title\nOpen ${url}`, { columns: 30 })),
    ).toEqual(['│', '●  Title', '┃', '┃  Open', `┃  ${url}`, '┃'])
  })
})
