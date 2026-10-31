// Updates the local-env formula of cgaube/homebrew-tap to a new release.
//
// Usage: bun update-formula.ts <formula.rb> <version> <tag> <sha256>
//
// Only the version, the release tag in the URL and the checksum change:
// everything else in the formula is the tap's to edit.

const [path, version, tag, sha256] = process.argv.slice(2)
if (!path || !version || !tag || !sha256) {
  console.error(
    'Usage: update-formula.ts <formula.rb> <version> <tag> <sha256>',
  )
  process.exit(1)
}

let formula = await Bun.file(path).text()

// Stops instead of writing a formula that changed shape
const replace = (pattern: RegExp, replacement: string) => {
  const matches = formula.match(new RegExp(pattern, 'gm'))?.length ?? 0
  if (matches !== 1) {
    console.error(`${pattern}: ${matches} matches, expected 1`)
    process.exit(1)
  }
  formula = formula.replace(new RegExp(pattern, 'm'), replacement)
}

replace(/^( {2}version )"[^"]*"/, `$1"${version}"`)
replace(/(releases\/download\/)[^/]+\//, `$1${tag}/`)
replace(/^( {2}sha256 )"[0-9a-f]+"/, `$1"${sha256}"`)

await Bun.write(path, formula)
