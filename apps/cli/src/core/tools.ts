import { execa } from 'execa'
import { styleText } from 'node:util'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  type Installed,
  listCollections,
  listGalaxyRoles,
  listRoles,
  playbookOf,
  readInstalled,
  readProfile,
  readSelection,
  readVariables,
  type Role,
  writeInstalled,
  writeProfile,
  writeSelection,
  writeVariables,
} from '#services/dashboard/tools.js'
import {
  externalRoles,
  missingInputs,
  parseInputText,
  passedValues,
  playbookRoots,
  roleValues,
  unsupportedSecrets,
  type WantedInput,
  wantedInputs,
  wantedRoles,
} from '#services/dashboard/role-graph.js'
import { SOURCES_DIR } from '#cli/sources/sources.js'
import { logger } from '#cli/utils/logger.js'
import {
  askConfirm,
  askPassword,
  askSelect,
  askText,
  canAsk,
} from '#cli/utils/prompt.js'
import { hasCommand } from '#cli/utils/brew.js'
import { HOME_DIR } from '#cli/core/paths.js'
import { createRunFolder } from '#cli/core/run-folder.js'
import { readConfig } from '#cli/core/config.js'
import {
  GALAXY_DIR,
  galaxyRequirements,
  galaxyRolesNeedingSudo,
  installGalaxyCollections,
} from '#cli/core/galaxy-collections.js'
import {
  type PlaybookSummary,
  renderPlaybook,
} from '#cli/core/playbook-output.js'

// The tools picked in the dashboard (volumes/tools/picked.json), the profile
// (profile.json) and the installs that ran: services/dashboard/tools.ts
export const TOOLS_DIR = resolve(HOME_DIR, 'volumes/tools')

export type PickedTools = {
  roles: Role[]
  // Picked, but no longer in any source
  missing: string[]
}

export const readPickedTools = (catalog: Role[]): PickedTools => {
  const byId = new Map(catalog.map((role) => [role.id, role]))
  const picked = readSelection(TOOLS_DIR)
  return {
    roles: picked.flatMap((id) => byId.get(id) ?? []),
    missing: picked.filter((id) => !byId.has(id)),
  }
}

export const listCatalog = () => listRoles(SOURCES_DIR)

// Drops picks whose role left the sources: Ansible would stop on their path
export const unpickTools = (catalog: Role[], ids: string[]) =>
  writeSelection(
    TOOLS_DIR,
    readSelection(TOOLS_DIR).filter((id) => !ids.includes(id)),
  )

// The saved profile. One that left the sources is dropped, with the id it
// had, so the caller can say so.
export const readSavedProfile = (
  catalog: Role[],
): { profile: Role | null; gone: string | null } => {
  const id = readProfile(TOOLS_DIR)
  if (!id) return { profile: null, gone: null }
  const profile = catalog.find((role) => role.id === id && role.isProfile)
  if (profile) return { profile, gone: null }
  saveProfile(null)
  return { profile: null, gone: id }
}

export const saveProfile = (profile: Role | null) => {
  mkdirSync(TOOLS_DIR, { recursive: true })
  writeProfile(TOOLS_DIR, profile?.id ?? null)
}

export const listProfiles = (catalog: Role[]) =>
  catalog.filter((role) => role.isProfile)

// The name to type: a collection's role without its collection
export const shortName = (role: Role) => role.name.split('.').at(-1)!

// A profile to type, with its label when that says more: "frontend
// (Frontend developer with AWS tools)", "backend" for the label Backend
export const describeProfile = (profile: Role) => {
  const name = shortName(profile)
  return profile.label.toLowerCase() === name.toLowerCase()
    ? name
    : `${name} (${profile.label})`
}

// A profile by its short name (backend) or full name
// (cgaube.profiles.backend), or by <source>/<full name> when two sources have
// one. Not by its label: a label is for reading, and can be a sentence.
export const findProfile = (catalog: Role[], name: string): Role => {
  const matches = catalog.filter((role) =>
    name.includes('/')
      ? role.id === name
      : [role.name, shortName(role)].includes(name),
  )
  const profiles = matches.filter((role) => role.isProfile)
  if (profiles.length > 1) {
    // Each by its full name, which tells collections apart. Plain roles of
    // the same name in two sources share it: those by <source>/<name>.
    const names = profiles.map((profile) =>
      profiles.some((other) => other !== profile && other.name === profile.name)
        ? profile.id
        : profile.name,
    )
    throw new Error(
      `Several profiles are named ${name}: name one of ${names.join(', ')}.`,
    )
  }
  const [profile] = profiles
  if (profile) return profile
  if (matches.length > 0) {
    throw new Error(
      `${name} is a tool, not a profile: pick it in the dashboard (Tools).`,
    )
  }
  const known = listProfiles(catalog).map(describeProfile)
  throw new Error(
    known.length > 0
      ? `No profile named ${name}. Profiles: ${known.join(', ')}.`
      : `No profile named ${name}: your sources have no profile.`,
  )
}

// Tools no longer wanted (picked, in the profile, or included by those) stay
// on the Mac: local-env doesn't uninstall. Forgets them, so the dashboard no
// longer lists them as installed. Their ids.
export const forgetUnwanted = (catalog: Role[], roots: Role[]) => {
  const wanted = wantedRoles(
    catalog,
    roots.map(({ id }) => id),
  )
  const installed = readInstalled(TOOLS_DIR)
  const forgotten = Object.keys(installed).filter((id) => !wanted.has(id))
  if (forgotten.length > 0) {
    for (const id of forgotten) delete installed[id]
    writeInstalled(TOOLS_DIR, installed)
  }
  return forgotten
}

// The roots and the roles they include, in catalog order
const withDependencies = (catalog: Role[], roots: Role[]) => {
  const wanted = wantedRoles(
    catalog,
    roots.map(({ id }) => id),
  )
  return catalog.filter(({ id }) => wanted.has(id))
}

// The roots of the next install: the saved profile and the picks still in
// the sources. Read only: install says when the profile or a pick left them.
export const currentRoots = (catalog: Role[]) => {
  const profileId = readProfile(TOOLS_DIR)
  const picked = readSelection(TOOLS_DIR)
  return catalog.filter(
    ({ id, isProfile }) =>
      (id === profileId && isProfile) || picked.includes(id),
  )
}

// For `local-env update`: upgrades the Galaxy collections of the tools you
// want (your profile, your picks and what they include) to the newest
// version their ranges allow. It runs no playbook: what it installed, as
// lines for the update's summary. Galaxy out of reach, or no Ansible, only
// warns: the rest of the update goes on.
export const upgradeGalaxyCollections = async ({
  dryRun = false,
}: {
  dryRun?: boolean
}): Promise<string[]> => {
  const catalog = listCatalog()
  const roots = currentRoots(catalog)
  const requirements = galaxyRequirements(withDependencies(catalog, roots))
  if (requirements.length === 0) return []
  // The install opens this group itself
  if (dryRun || !(await hasCommand('ansible-galaxy'))) {
    logger.group('Collections from Galaxy')
    logger.info(
      dryRun ? 'Skipped (dry run)' : 'Skipped: Ansible is not installed',
    )
    return []
  }
  using folder = createRunFolder()
  try {
    const upgraded = await installGalaxyCollections(requirements, folder.path, {
      upgrade: true,
    })
    return upgraded.length > 0
      ? [
          `Galaxy collections upgraded: ${upgraded.join(', ')}. Run \`local-env install\` to apply them.`,
        ]
      : []
  } catch (error) {
    logger.warn(error instanceof Error ? error.message : String(error))
    return []
  }
}

// The inputs of the roots and the roles they include
// (meta/argument_specs.yml), Galaxy roles included once installed
export const readWantedInputs = (catalog: Role[], roots: Role[]) =>
  wantedInputs(
    catalog,
    roots.map(({ id }) => id),
    listGalaxyRoles(GALAXY_DIR),
  )

// "email (Git, Node)": an input, and the roles that use it
export const describeInput = ({ name, roles }: WantedInput) =>
  `${name} (${roles.join(', ')})`

// Where each input stands, for `install --dry-run`: one line each
export const describeInputs = (inputs: WantedInput[]) => {
  const values = readVariables(TOOLS_DIR)
  return inputs.map((input) => {
    const state = input.provided
      ? `${JSON.stringify(input.given)}, set by ${input.setBy.join(', ')}`
      : input.secret
        ? input.required
          ? 'a secret local-env does not support yet'
          : 'a secret, not passed'
        : input.name in values
          ? `${JSON.stringify(values[input.name])}, saved`
          : input.default !== undefined
            ? `the role's default, ${JSON.stringify(input.default)}`
            : input.required
              ? 'missing: install asks for it'
              : 'not set'
    return `${describeInput(input)}: ${state}`
  })
}

// The value of a text typed for an input (`local-env vars set`), or why it
// is refused: a bool from true or false, one of the choices, else as the
// dashboard reads it (a number, a list from "a, b", a dict from JSON)
export const parseVariableText = (
  input: WantedInput,
  text: string,
): { value: unknown } | { error: string } => {
  if (text.trim() === '') {
    return { error: 'Give a value, or use `local-env vars unset`.' }
  }
  if (input.choices) {
    const choice = input.choices.find((option) => String(option) === text)
    return choice === undefined
      ? { error: `Use one of: ${input.choices.join(', ')}.` }
      : { value: choice }
  }
  if (input.type === 'bool') {
    if (/^(true|yes|on)$/i.test(text)) return { value: true }
    if (/^(false|no|off)$/i.test(text)) return { value: false }
    return { error: 'Use true or false.' }
  }
  return parseInputText(input, text)
}

// The inputs of every role of the sources, and of the installed Galaxy
// roles: what `vars set` accepts a value for
export const readAllInputs = (catalog: Role[]) =>
  wantedInputs(
    catalog,
    catalog.map(({ id }) => id),
    listGalaxyRoles(GALAXY_DIR),
  )

// Stops before anything runs when a role needs what local-env can't give:
// a secret (no_log), or values without a terminal to ask them in
export const checkInputs = (inputs: WantedInput[]) => {
  const secrets = unsupportedSecrets(inputs)
  if (secrets.length > 0) {
    throw new Error(
      `Your tools need a secret that local-env does not support yet: ${secrets.map(describeInput).join(', ')}. The role would fail without it, so nothing ran.`,
    )
  }
  const missing = missingInputs(inputs, readVariables(TOOLS_DIR))
  if (missing.length > 0 && !canAsk()) {
    throw new Error(
      `Your tools need values: ${missing.map(describeInput).join(', ')}. Set them with \`local-env vars set\`, in Variables on the Tools page of the dashboard, or run \`local-env install\` in a terminal.`,
    )
  }
  return missing
}

// A question about a variable on one line, its description dimmed after
// it: clack draws its left border on the first line of a question only
export const questionOf = (head: string, description: string | null) =>
  description ? `${head} · ${styleText('dim', description)}` : head

// Asks for each value in the terminal, of its type: a select for choices, a
// yes/no for a bool, text for the rest (parseInputText). The answers, by
// name.
const askInputs = async (missing: WantedInput[]) => {
  const answers: Record<string, unknown> = {}
  for (const input of missing) {
    const message = questionOf(
      `${input.name}, for ${input.roles.join(', ')}`,
      input.description,
    )
    if (input.choices) {
      const choices = input.choices
      const value = await askSelect(
        message,
        choices.map((choice) => ({
          value: String(choice),
          label: String(choice),
        })),
      )
      answers[input.name] = choices.find((choice) => String(choice) === value)
    } else if (input.type === 'bool') {
      answers[input.name] = await askConfirm(message, false)
    } else {
      // Text, turned into a value of its type: a number, a list from "a, b",
      // a dict from JSON
      const text = await askText(message, '', {
        validate: (answer) => {
          if (!answer.trim()) return 'Type a value, or press Ctrl-C to stop'
          const parsed = parseInputText(input, answer)
          return 'error' in parsed ? parsed.error : undefined
        },
      })
      const parsed = parseInputText(input, text)
      answers[input.name] = 'value' in parsed ? parsed.value : text
    }
  }
  return answers
}

// Where the answers went, and where to change them: `local-env vars set` and
// the dashboard's Variables sheet edit the same file. With --no-save, they
// were for this run only.
const showAnswers = (answered: WantedInput[], saved: boolean) => {
  const names = answered.map(({ name }) => name).join(', ')
  const one = answered.length === 1
  if (!saved) {
    logger.info(`Used ${names} for this run only: not saved (--no-save).`)
    return
  }
  logger.step(`Saved ${names}`)
  logger.info(
    `Change ${one ? 'it' : 'them'} with \`local-env vars set\`, or in Variables on the Tools page: https://local-env.${readConfig().domain}/tools`,
  )
}

// Ansible finds a collection only at ansible_collections/<namespace>/<name>,
// and a source has it at ansible/<folder>: links each collection of the
// sources there, in this folder. Of two sources with the same collection, the
// first one is linked. The folder, for ANSIBLE_COLLECTIONS_PATH.
const linkCollections = (catalog: Role[], dir: string) => {
  for (const source of new Set(catalog.map((role) => role.source))) {
    const ansible = join(SOURCES_DIR, source, 'ansible')
    for (const { folder, name } of listCollections(ansible)) {
      const [namespace = '', collection = ''] = name.split('.')
      const link = join(dir, 'ansible_collections', namespace, collection)
      if (existsSync(link)) continue
      mkdirSync(join(dir, 'ansible_collections', namespace), {
        recursive: true,
      })
      symlinkSync(join(ansible, folder), link)
    }
  }
  return dir
}

// Runs the roots (the profile, then the picked roles) on this Mac, as you,
// drawn like the rest of the CLI (playbook-output.ts), or with Ansible's own
// output when verbose. Their playbook is written to a folder only you can
// read, removed once Ansible is done, or stopped (run-folder.ts). A role that
// uses sudo makes local-env ask for your password first: Ansible reads it
// from its stdin, so it is never on the disk. The roles' inputs it lacks are
// asked next, saved unless `save` is false, and passed to Ansible as extra
// vars. Records what ran, for the dashboard.
export const runPlaybook = async (
  catalog: Role[],
  roots: Role[],
  { verbose = false, save = true }: { verbose?: boolean; save?: boolean } = {},
): Promise<PlaybookSummary | null> => {
  // What Ansible runs: the roots and the ones they include
  const run = withDependencies(catalog, roots)

  // Its playbook and the collection links, removed once Ansible is done, on
  // Ctrl-C too (run-folder.ts)
  using folder = createRunFolder()

  // The Galaxy collections they need first: their roles can use sudo too
  await installGalaxyCollections(galaxyRequirements(run), folder.path, {
    verbose,
  })
  // Read once the Galaxy roles are installed. Checked before the password:
  // a run that can't start asks nothing.
  const inputs = readWantedInputs(catalog, roots)
  const missing = checkInputs(inputs)
  const sudo = [
    ...run.filter((role) => role.needsSudo).map(({ label }) => label),
    ...galaxyRolesNeedingSudo(
      externalRoles(
        catalog,
        roots.map(({ id }) => id),
      ),
    ),
  ]
  // Required: without it, Ansible runs sudo without a password and the role
  // fails
  const password =
    sudo.length > 0
      ? await askPassword(`Your password, for sudo (${sudo.join(', ')})`, {
          required: true,
        })
      : null

  const answers = await askInputs(missing)
  if (save && missing.length > 0) {
    mkdirSync(TOOLS_DIR, { recursive: true })
    writeVariables(TOOLS_DIR, { ...readVariables(TOOLS_DIR), ...answers })
  }
  if (missing.length > 0) showAnswers(missing, save)
  const values = { ...readVariables(TOOLS_DIR), ...answers }
  // Only the inputs the wanted roles declare, never a secret, and not one
  // that the roles including it give: extra vars win over every other
  // variable of every role, the `vars:` of a dependency too
  const extraVars = passedValues(inputs, values)
  const extraVarsFile = join(folder.path, 'extra-vars.json')
  if (Object.keys(extraVars).length > 0) {
    writeFileSync(extraVarsFile, `${JSON.stringify(extraVars, null, 2)}\n`, {
      mode: 0o600,
    })
  }

  const collections = linkCollections(catalog, join(folder.path, 'collections'))
  const playbook = join(folder.path, 'playbook.yml')
  const args = [
    '--inventory',
    'localhost,',
    // `-` is stdin: Ansible reads it to the end, then strips the newline
    // (only that: a password can start or end with a space)
    ...(password ? ['--become-password-file', '-'] : []),
    ...(Object.keys(extraVars).length > 0
      ? ['--extra-vars', `@${extraVarsFile}`]
      : []),
    playbook,
  ]
  writeFileSync(
    playbook,
    // Each role once: a pick the profile includes is not named again
    playbookOf(
      playbookRoots(
        catalog,
        roots.map(({ id }) => id),
      ).map((id) => {
        const role = catalog.find((other) => other.id === id)!
        // A collection's role by its name, so it runs in its collection; a
        // plain role by its path
        return role.collection
          ? role.name
          : join(SOURCES_DIR, role.source, 'ansible', role.folder)
      }),
    ),
    { mode: 0o600 },
  )
  const env: Record<string, string> = {
    // The collections of the sources, then those from Galaxy: not the user's
    // own (galaxy-collections.ts). Ansible adds those of its package.
    ANSIBLE_COLLECTIONS_PATH: [collections, GALAXY_DIR].join(':'),
    // Dependencies are named, not paths: every source's plain roles
    ANSIBLE_ROLES_PATH: [
      ...new Set(
        catalog.map(({ source }) => join(SOURCES_DIR, source, 'ansible')),
      ),
    ].join(':'),
    // The Python that runs Ansible, without the discovery warning
    ANSIBLE_PYTHON_INTERPRETER: 'auto_silent',
    ANSIBLE_LOCALHOST_WARNING: 'false',
  }
  // The password, written then closed. Without one, nothing: a role never
  // waits for input.
  const stdin = password
    ? { input: `${password}\n` }
    : { stdin: 'ignore' as const }

  // null with Ansible's own output, which has its recap
  let summary: PlaybookSummary | null = null
  if (verbose) {
    const child = execa('ansible-playbook', args, {
      ...stdin,
      stdout: 'inherit',
      stderr: 'inherit',
      env,
    })
    // A terminal's Ctrl-C reaches Ansible too (same process group), a kill
    // doesn't
    folder.onSignal((signal) => child.kill(signal))
    await child
  } else {
    const child = execa('ansible-playbook', args, {
      ...stdin,
      reject: false,
      env: { ...env, ANSIBLE_STDOUT_CALLBACK: 'ansible.posix.jsonl' },
    })
    folder.onSignal((signal) => child.kill(signal))
    summary = await renderPlaybook(
      child.iterable({ from: 'stdout' }),
      // As the dashboard shows them. Ansible names a plain role by its
      // folder, which is its name.
      new Map(catalog.map(({ name, label }) => [name, label])),
    )
    const { exitCode, stderr } = await child
    if (exitCode !== 0) {
      // Ansible's own errors (a role it can't find, a YAML error) come
      // before any task: they are only in its stderr
      if (summary.failed === 0 && stderr) {
        logger.log(String(stderr).trim().split('\n').slice(-10).join('\n'))
      }
      // sudo wanted a password local-env didn't ask for: the scan missed a
      // become (`become: "{{ … }}"`, a role it doesn't read)
      if (!password && summary.needPassword.length > 0) {
        logger.callout(
          'warn',
          [
            `A role needs your sudo password: ${summary.needPassword.join(', ')}`,
            'local-env did not see that it uses sudo, so it did not ask for it. Please report it, with the name of the role.',
          ].join('\n'),
        )
      }
      throw new Error(`ansible-playbook exited with ${exitCode}`)
    }
  }

  const installedAt = new Date().toISOString()
  const installed: Installed = readInstalled(TOOLS_DIR)
  for (const role of run) {
    // What it got: a value changed since makes it changed
    const got = roleValues(role, extraVars)
    installed[role.id] = {
      revision: role.revision,
      installedAt,
      ...(Object.keys(got).length > 0 ? { values: got } : {}),
    }
  }
  mkdirSync(TOOLS_DIR, { recursive: true })
  writeInstalled(TOOLS_DIR, installed)
  return summary
}
