import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { HOME_DIR } from '#cli/core/paths.js'

// What local-env keeps about the logins, in the home folder: the accounts
// the user does not want to be asked about again, as <type>:<identity>
const STATE_FILE = join(HOME_DIR, 'volumes/logins.json')

type State = { ignored: string[] }

const texts = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const readState = (): State => {
  if (!existsSync(STATE_FILE)) return { ignored: [] }
  try {
    const { ignored } = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return { ignored: texts(ignored) }
  } catch {
    return { ignored: [] }
  }
}

const writeState = (state: State) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

const key = (type: string, identity: string) => `${type}:${identity}`

export const isIgnored = (type: string, identity: string) =>
  readState().ignored.includes(key(type, identity))

export const setIgnored = (
  type: string,
  identity: string,
  ignored: boolean,
) => {
  const state = readState()
  const others = state.ignored.filter((value) => value !== key(type, identity))
  writeState({
    ...state,
    ignored: ignored ? [...others, key(type, identity)] : others,
  })
}
