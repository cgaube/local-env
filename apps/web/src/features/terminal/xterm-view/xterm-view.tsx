import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import type { TerminalSession } from '#ui/features/terminal/terminal-session.ts'

// Always dark, whatever the page's theme, as the CLI's colors are made for a
// dark terminal: Dracula, the palette of the dashboard's dark theme
// (index.css), so the terminal matches it
const THEME = {
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f2',
  cursorAccent: '#282a36',
  selectionBackground: '#44475a',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
}
// Once the run ended: no cursor. Painted over, not hidden with an escape
// code, which the replayed output could undo.
const READ_ONLY_THEME = {
  ...THEME,
  cursor: THEME.background,
  cursorAccent: THEME.background,
}

// The run's output, and the keys typed in it: a prompt of the CLI, the sudo
// password. Loaded with React.lazy: xterm weighs on no other page.
export default function XtermView({ session }: { session: TerminalSession }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      // The default line height: taller lines break clack's box-drawing
      // characters (│, ┃) into dashes, as the font draws them
      scrollback: 10_000,
      theme: THEME,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)

    for (const chunk of session.output()) terminal.write(chunk)
    const stopOutput = session.onOutput((event) => {
      if (event.reset) terminal.reset()
      else terminal.write(event.chunk)
    })
    // Keys go to the run while it runs: read-only before and after it
    const applyRunning = () => {
      const running = session.getSnapshot().run?.status === 'running'
      terminal.options.disableStdin = !running
      terminal.options.cursorBlink = running
      terminal.options.theme = running ? THEME : READ_ONLY_THEME
    }
    applyRunning()
    const stopState = session.subscribe(applyRunning)
    const input = terminal.onData((data) => session.input(data))
    const resize = terminal.onResize(({ cols, rows }) =>
      session.resize(cols, rows),
    )
    // The sheet's width: the CLI draws its lines for it
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(element)
    fit.fit()
    session.resize(terminal.cols, terminal.rows)
    terminal.focus()

    return () => {
      observer.disconnect()
      stopOutput()
      stopState()
      input.dispose()
      resize.dispose()
      terminal.dispose()
    }
  }, [session])

  return (
    <div
      ref={container}
      data-testid="terminal"
      // THEME.background around the terminal's own canvas
      style={{ backgroundColor: THEME.background }}
      className="min-h-0 flex-1 overflow-hidden rounded-md p-3"
    />
  )
}
