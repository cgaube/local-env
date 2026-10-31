import type { Config } from '../config.js'

export type ApplyOptions = {
  // Accept every default instead of asking
  yes: boolean
  // Set by the setup wizard: also offer to redo work that is still valid
  review: boolean
}

// One entry of config.json, with everything needed to change it from the
// setup wizard or `local-env config set`
// Methods, not function properties: a list can then hold settings of
// different value types (string, number)
export type Setting<K extends keyof Config = keyof Config> = {
  key: K
  // Shown as a group title in setup and in `config` help
  title: string
  // Normalizes a raw value; throws a readable error when it's invalid
  parse(raw: string): Config[K]
  ask(current: Config[K]): Promise<Config[K]>
  // Makes the machine match the value. Idempotent: runs on every setup, and
  // `previous` is null on the first one.
  apply(
    next: Config[K],
    previous: Config[K] | null,
    options: ApplyOptions,
  ): Promise<void>
}
