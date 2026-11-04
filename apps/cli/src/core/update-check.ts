import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { FORMULA_URL, isNewer, versionOfFormula } from '#cli/core/homebrew.js'
import { HOME_DIR } from '#cli/core/paths.js'

// Whether a newer local-env can be installed. It reads the version of the
// Homebrew formula, which the release workflow updates last: once it says a
// version, `brew upgrade` installs it. Asked at most once a day, with a short
// timeout: the answer is kept in the home folder, so every command can say a
// new version is out until you upgrade.

const CHECK_FILE = join(HOME_DIR, 'update-check.json')
const DAY = 24 * 60 * 60 * 1000
// A slow network never holds a command up for long
const TIMEOUT = 1500

// Tests point it at a fake (tests/support/run-cli.ts)
const formulaUrl = () => process.env.LOCAL_ENV_FORMULA_URL ?? FORMULA_URL

type UpdateCheck = { checkedAt: string; latest: string | null }

const readCheck = (): UpdateCheck | null => {
  if (!existsSync(CHECK_FILE)) return null
  try {
    const check = JSON.parse(readFileSync(CHECK_FILE, 'utf8'))
    return typeof check?.checkedAt === 'string' ? check : null
  } catch {
    return null
  }
}

const fetchLatest = async () => {
  try {
    const response = await fetch(formulaUrl(), {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) return null
    return versionOfFormula(await response.text())
  } catch {
    // Offline, or GitHub is slow: ask again tomorrow
    return null
  }
}

const saveCheck = (check: UpdateCheck) => {
  try {
    writeFileSync(CHECK_FILE, `${JSON.stringify(check, null, 2)}\n`)
  } catch {
    // A read-only home folder: ask again next time
  }
}

// The latest version now, whatever the last answer: `update` asks for it.
// null when the formula can't be read.
export const checkLatestNow = async () => {
  const latest = await fetchLatest()
  saveCheck({
    checkedAt: new Date().toISOString(),
    latest: latest ?? readCheck()?.latest ?? null,
  })
  return latest
}

// The newer version, or null. Reads the formula when the last answer is a
// day old.
export const findNewerVersion = async (current: string) => {
  let check = readCheck()
  if (!check || Date.now() - Date.parse(check.checkedAt) > DAY) {
    const latest = await fetchLatest()
    check = {
      checkedAt: new Date().toISOString(),
      // A failed check keeps what the last one found
      latest: latest ?? check?.latest ?? null,
    }
    saveCheck(check)
  }
  return check.latest && isNewer(check.latest, current) ? check.latest : null
}
