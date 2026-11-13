import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { HOME_DIR } from '#cli/core/paths.js'

// What local-env keeps about the logins, in the home folder: the accounts
// the user does not want to be asked about again, as <type>:<identity>, the
// sections of ~/.aws/config that local-env wrote, by header, and the registry
// tokens local-env saved in Dockhand, by host: when, and when they expire
const STATE_FILE = join(HOME_DIR, 'volumes/logins.json')

type State = {
  ignored: string[]
  awsSections: string[]
  registryTokens: Record<string, TokenDates>
}

// ISO dates
type TokenDates = { savedAt: string; expiresAt: string }

const EMPTY: State = { ignored: [], awsSections: [], registryTokens: {} }

const texts = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const tokenDates = (value: unknown): Record<string, TokenDates> =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, TokenDates] =>
            isRecord(entry[1]) &&
            typeof entry[1].savedAt === 'string' &&
            typeof entry[1].expiresAt === 'string',
        ),
      )
    : {}

const readState = (): State => {
  if (!existsSync(STATE_FILE)) return EMPTY
  try {
    const { ignored, awsSections, registryTokens } = JSON.parse(
      readFileSync(STATE_FILE, 'utf8'),
    )
    return {
      ignored: texts(ignored),
      awsSections: texts(awsSections),
      registryTokens: tokenDates(registryTokens),
    }
  } catch {
    return EMPTY
  }
}

const writeState = (state: State) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

export const readAwsSections = () => readState().awsSections

export const writeAwsSections = (headers: string[]) =>
  writeState({ ...readState(), awsSections: [...new Set(headers)].sort() })

// The token of this host that local-env last saved in Dockhand
export const readRegistryToken = (host: string) => {
  const dates = readState().registryTokens[host]
  return dates
    ? { savedAt: new Date(dates.savedAt), expiresAt: new Date(dates.expiresAt) }
    : undefined
}

export const writeRegistryToken = (
  host: string,
  { savedAt, expiresAt }: { savedAt: Date; expiresAt: Date },
) => {
  const state = readState()
  writeState({
    ...state,
    registryTokens: {
      ...state.registryTokens,
      [host]: {
        savedAt: savedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    },
  })
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
