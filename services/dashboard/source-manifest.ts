import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// The manifest of a source: local-env.yml at the root of its repo. It says
// what the source is, for every Mac that adds it: its name (unique, the
// folder in volumes/sources), its label (what people read) and its logins
// and its secrets (docs/3-how-it-works/source-manifest.md). Shared by the
// dashboard and
// the CLI: no imports of the CLI.

export const SOURCE_MANIFEST_FILE = 'local-env.yml'

export const isValidSourceName = (name: string) =>
  /^[a-z0-9][a-z0-9-]*$/.test(name)

// A login as a role or a secret names it: <login>, or <source>/<login>
export const isLoginRef = (ref: string) =>
  /^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/.test(ref)

// A role as `bootstrap` names it: <namespace>.<collection>.<role>, or a plain
// role's name
export const isRoleName = (name: string) => /^[A-Za-z0-9_][\w.-]*$/.test(name)

export type SourceManifest = {
  name: string
  label: string | null
  // By login name, as written: the CLI checks each entry by its type
  logins: Record<string, unknown>
  // By variable name, as written: where its value is, in a vault the logins
  // reach. The CLI checks each entry (apps/cli/src/logins/secrets.ts).
  secrets: Record<string, unknown>
  // The roles that make this Mac ready for the logins, run before them
  // (docs/3-how-it-works/source-bootstrap.md): by name, as dependencies
  // name roles
  bootstrap: string[]
}

// A manifest that is there but wrong. The message names the field.
export class SourceManifestError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// null when the source has no manifest. Throws a SourceManifestError when it
// has one that is not valid.
export const readSourceManifest = (dir: string): SourceManifest | null => {
  const path = join(dir, SOURCE_MANIFEST_FILE)
  if (!existsSync(path)) return null

  let content: unknown
  try {
    content = Bun.YAML.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new SourceManifestError(
      `${SOURCE_MANIFEST_FILE} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(content)) {
    throw new SourceManifestError(
      `${SOURCE_MANIFEST_FILE} must be a mapping with a name`,
    )
  }

  const { name, label, logins, secrets, bootstrap } = content
  if (typeof name !== 'string' || !isValidSourceName(name)) {
    throw new SourceManifestError(
      `${SOURCE_MANIFEST_FILE}: name must be lowercase letters, digits and dashes (${name === undefined ? 'missing' : JSON.stringify(name)})`,
    )
  }
  if (label !== undefined && label !== null && typeof label !== 'string') {
    throw new SourceManifestError(`${SOURCE_MANIFEST_FILE}: label must be text`)
  }
  if (logins !== undefined && logins !== null && !isRecord(logins)) {
    throw new SourceManifestError(
      `${SOURCE_MANIFEST_FILE}: logins must be a mapping of login names`,
    )
  }

  if (secrets !== undefined && secrets !== null && !isRecord(secrets)) {
    throw new SourceManifestError(
      `${SOURCE_MANIFEST_FILE}: secrets must be a mapping of variable names`,
    )
  }

  if (
    bootstrap !== undefined &&
    bootstrap !== null &&
    (!Array.isArray(bootstrap) ||
      !bootstrap.every((role) => typeof role === 'string' && isRoleName(role)))
  ) {
    throw new SourceManifestError(
      `${SOURCE_MANIFEST_FILE}: bootstrap must be a list of role names`,
    )
  }

  return {
    name,
    label: label?.trim() || null,
    logins: logins ?? {},
    secrets: secrets ?? {},
    bootstrap: [...new Set((bootstrap as string[] | null) ?? [])],
  }
}

// The manifest, or null when there is none or it is not valid: for what only
// shows it (the dashboard, lists)
export const tryReadSourceManifest = (dir: string) => {
  try {
    return readSourceManifest(dir)
  } catch {
    return null
  }
}
