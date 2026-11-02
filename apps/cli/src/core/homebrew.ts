// How local-env is installed: the formula of its Homebrew tap. The release
// workflow updates the same formula (.github/workflows/release.yml, which
// can't import this file). The CLI (core/update-check.ts) and the dashboard
// (apps/web) read its version: no imports here, so both can.
export const HOMEBREW_TAP = 'cgaube/homebrew-tap'
export const HOMEBREW_TAP_BRANCH = 'main'
export const HOMEBREW_FORMULA = 'local-env'

// The formula as `brew upgrade` will install it, once brew updated the tap
export const FORMULA_URL = `https://raw.githubusercontent.com/${HOMEBREW_TAP}/${HOMEBREW_TAP_BRANCH}/Formula/${HOMEBREW_FORMULA}.rb`

export const UPGRADE_COMMAND = `brew upgrade ${HOMEBREW_FORMULA}`
// What to tell people: it runs the brew upgrade, then updates the rest on the
// new version (core/self-update.ts)
export const UPDATE_COMMAND = 'local-env update'

// For a binary downloaded from a release rather than installed with brew
export const RELEASES_PAGE =
  'https://github.com/cgaube/local-env/releases/latest'

// The formula's `version "0.3.0"` line
export const versionOfFormula = (formula: string) =>
  /^\s*version "(\d+\.\d+\.\d+)"$/m.exec(formula)?.[1] ?? null

// 0.10.0 is newer than 0.9.1
export const isNewer = (version: string, than: string) => {
  const a = version.split('.').map(Number)
  const b = than.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}
