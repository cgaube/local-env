import { Command } from 'commander'
import { wantedRoles } from '#services/dashboard/role-graph.js'
import type { Role } from '#services/dashboard/tools.js'
import { readConfig } from '#cli/core/config.js'
import {
  describeInputs,
  describeProfile,
  findProfile,
  forgetUnwanted,
  listCatalog,
  listProfiles,
  readPickedTools,
  readSavedProfile,
  readWantedInputs,
  runPlaybook,
  saveProfile,
  unpickTools,
} from '#cli/core/tools.js'
import { planRequiredStacks } from '#cli/providers/docker/required-stacks.js'
import { deployStacks } from '#cli/providers/docker/stack-deploy.js'
import type { PlaybookSummary } from '#cli/core/playbook-output.js'
import { hasCommand, logger } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
import { askConfirm, askSelect, canAsk } from '#cli/utils/prompt.js'

// "acme/cgaube.dev.git" -> "cgaube.dev.git": a role gone from the sources
// has only its id left
const shortName = (id: string) => id.split('/').slice(1).join('/') || id

// What left the sources since the last install: the saved profile, and picks
export type LeftSources = { profile: string | null; picks: string[] }

// At the end of the output, where it is seen: just before the summary. One
// list for the tools no longer wanted, unpicked or gone from the sources.
// Tools only: a profile is a set of tools, not one more, switching profiles
// is no news, and a profile that left is said at the start. By label, as the
// dashboard shows them; one gone from the sources by its name.
const showForgotten = (
  forgotten: string[],
  catalog: Role[],
  left: LeftSources = { profile: null, picks: [] },
) => {
  const byId = new Map(catalog.map((role) => [role.id, role]))
  const ids = [...new Set([...forgotten, ...left.picks])].filter(
    (id) => id !== left.profile,
  )
  const tools = ids.flatMap((id) => {
    const role = byId.get(id)
    if (role?.isProfile) return []
    return [role ? role.label : `${shortName(id)} (no longer in your sources)`]
  })
  if (tools.length === 0) return
  const one = tools.length === 1
  logger.callout(
    'info',
    [
      'No longer wanted, still on this Mac',
      tools.join(', '),
      `local-env doesn't uninstall: remove ${one ? 'it' : 'them'} yourself if you want ${one ? 'it' : 'them'} gone. ${one ? 'It is' : 'They are'} no longer listed as installed.`,
    ].join('\n'),
    { tinted: true, padded: false },
  )
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`

// What ran: "the backend profile and 2 tools". A pick the profile includes
// is one of the profile's tools, not one more.
const describeRun = (catalog: Role[], profile: Role | null, picked: Role[]) => {
  const inProfile = profile
    ? wantedRoles(catalog, [profile.id])
    : new Set<string>()
  const tools = picked.filter(({ id }) => !inProfile.has(id))
  if (!profile) return plural(tools.length, 'tool')
  return tools.length > 0
    ? `the ${profile.label} profile and ${plural(tools.length, 'tool')}`
    : `the ${profile.label} profile`
}

// What the tasks did: "1 changed · 3 unchanged · 1 skipped"
const describeTasks = ({ changed, ok, skipped }: PlaybookSummary) =>
  [
    `${changed} changed`,
    `${ok} unchanged`,
    ...(skipped > 0 ? [`${skipped} skipped`] : []),
  ].join(' · ')

// The profile this run installs, first, where it is seen, and how to change
// it. Named with --no-save, it runs this time only. Not its tools: a profile
// can have hundreds.
const showProfile = (
  profile: Role,
  {
    saved,
    once,
    switched,
  }: { saved: Role | null; once: boolean; switched: boolean },
) => {
  logger.callout(
    'info',
    [
      `Profile: ${profile.label}`,
      ...(profile.description ? [profile.description] : []),
      // What happened to it, then how to change it
      ...(once
        ? [
            saved
              ? `This run only: your profile stays ${saved.label}.`
              : 'This run only: you have no profile saved.',
          ]
        : [
            'Change it on the Profiles page, or with `local-env install <profile>`.',
          ]),
    ].join('\n'),
    { tinted: false, padded: false },
  )
  if (switched) logger.step(`Saved ${profile.label} as your profile`)
}

// Whether to replace the saved profile with the named one: --yes says so;
// without a terminal, it doesn't switch and says how to
const confirmSwitch = async (
  saved: Role,
  named: Role,
  { yes }: { yes?: boolean },
) => {
  if (yes) return true
  if (!canAsk()) {
    throw new Error(
      `Switching your profile from ${saved.label} to ${named.label} needs a confirmation: run this in a terminal, or add --yes.`,
    )
  }
  if (
    await askConfirm(
      `Switch your profile from ${saved.label} to ${named.label}?`,
      true,
    )
  ) {
    return true
  }
  logger.info(
    `Your profile stays ${saved.label}. To install ${named.label} once, add --no-save.`,
  )
  return false
}

// No profile and no tool picked: asks for a profile, in a terminal. null
// for none, or without a terminal or a profile to pick.
const askProfile = async (catalog: Role[]): Promise<Role | null> => {
  const profiles = listProfiles(catalog)
  if (profiles.length === 0 || !canAsk()) return null
  const id = await askSelect('Pick your profile', [
    ...profiles.map((profile) => ({
      value: profile.id,
      label: profile.label,
      hint: profile.description ?? profile.name,
    })),
    { value: '', label: 'No profile', hint: 'pick tools in the dashboard' },
  ])
  return profiles.find((profile) => profile.id === id) ?? null
}

// Nothing to run: says how to pick
const showNothingPicked = (catalog: Role[]) => {
  const url = `https://local-env.${readConfig().domain}/tools`
  const profiles = listProfiles(catalog)
  logger.info(
    profiles.length > 0
      ? `Nothing to install. Install a profile with \`local-env install <profile>\` (${profiles.map(describeProfile).join(', ')}), or pick tools in the dashboard: ${url}`
      : `Nothing to install. Pick tools in the dashboard, then run \`local-env install\`: ${url}`,
  )
}

// --dry-run: what an install would run and the values it would pass,
// without running, saving or asking anything
const showDryRun = (catalog: Role[], roots: Role[], ran: string) => {
  logger.group('Dry run')
  logger.info(`Would install ${ran}`)
  const inputs = readWantedInputs(catalog, roots)
  if (inputs.length === 0) return
  logger.group('Variables')
  for (const line of describeInputs(inputs)) logger.log(line)
}

export type InstallOptions = {
  save: boolean
  verbose: boolean
  yes?: boolean
  dryRun: boolean
}

// What an install ran: "the Backend profile", and the counts of its tasks
// (none with --verbose: Ansible's recap says them)
export type Installed = { ran: string; summary: PlaybookSummary | null }

// The lines of the closing callout: what the install did, its counts dimmed
export const describeInstalled = ({ ran, summary }: Installed) => [
  `Installed ${ran}`,
  ...(summary ? [describeTasks(summary)] : []),
]

// Tools are picked in the dashboard, which can't run anything on the Mac:
// this runs what was picked, with the profile. A profile named here, or
// picked in the select when there is nothing to install, is saved as yours,
// unless --no-save. Returns what it installed, or null when it ran nothing
// (nothing picked, --dry-run, a switch declined). Exits on errors. Run by
// `local-env install` and `local-env onboard`, which close the frame.
export const runInstall = async (
  name: string | undefined,
  options: InstallOptions,
): Promise<Installed | null> => {
  // A dry run writes nothing: as --no-save, and nothing unpicked or
  // forgotten
  const write = !options.dryRun
  let forgotten: string[] = []
  let catalog: Role[] = []
  const left: LeftSources = { profile: null, picks: [] }
  try {
    catalog = listCatalog()
    const saved = readSavedProfile(catalog)
    // Said now: it changes what this install runs. The picks that left
    // are in the list of the end, with the tools no longer wanted.
    if (saved.gone) {
      left.profile = saved.gone
      logger.warn(
        `Your profile, ${shortName(saved.gone)}, is no longer in your sources: local-env no longer installs it.`,
      )
    }
    const { roles: picked, missing } = readPickedTools(catalog)
    if (missing.length > 0 && write) {
      unpickTools(catalog, missing)
      left.picks = missing
    }

    // Named here, or picked in the select when there is nothing else
    // to install
    const named =
      (name ? findProfile(catalog, name) : null) ??
      (write && !saved.profile && picked.length === 0
        ? await askProfile(catalog)
        : null)
    // Named here, another than yours: asked first, as it changes what
    // every later install runs
    if (
      write &&
      name &&
      named &&
      options.save &&
      saved.profile &&
      named.id !== saved.profile.id &&
      !(await confirmSwitch(saved.profile, named, options))
    ) {
      return null
    }
    if (named && options.save && write) saveProfile(named)
    const profile = named ?? saved.profile
    if (profile) {
      showProfile(profile, {
        saved: saved.profile,
        once: named !== null && !options.save,
        switched:
          write &&
          named !== null &&
          options.save &&
          named.id !== saved.profile?.id,
      })
    }
    const roots = [
      ...(profile ? [profile] : []),
      ...picked.filter(({ id }) => id !== profile?.id),
    ]
    // A profile run once (--no-save) leaves the saved one wanted
    const kept = named && !options.save ? saved.profile : null
    if (write) {
      forgotten = forgetUnwanted(catalog, [...roots, ...(kept ? [kept] : [])])
    }
    if (roots.length === 0) {
      showNothingPicked(catalog)
      showForgotten(forgotten, catalog, left)
      return null
    }
    if (options.dryRun) {
      showDryRun(catalog, roots, describeRun(catalog, profile, picked))
      return null
    }
    if (!(await hasCommand('ansible-playbook'))) {
      throw new Error(
        'Ansible is not installed. Run `local-env setup`, or `brew install ansible`.',
      )
    }

    // Asked first: the install then runs alone
    const stacks = await planRequiredStacks(catalog, roots, options)
    const summary = await runPlaybook(catalog, roots, options)
    const ran = describeRun(catalog, profile, picked)
    if (stacks) {
      // Each stack says how it went, in its own group
      await deployStacks(stacks, 'local-env install')
    }
    showForgotten(forgotten, catalog, left)
    return { ran, summary }
  } catch (error) {
    logger.error('Error installing tools:', error)
    showForgotten(forgotten, catalog, left)
    process.exit(1)
  }
}

export const installCommand = new Command('install')
  .description(
    'Install your profile and the tools picked in the dashboard (Tools)',
  )
  .argument(
    '[profile]',
    'A profile of your sources: saved as yours, then installed',
  )
  .option('--no-save', 'Install the profile this time, without saving it')
  .option(
    '-y, --yes',
    'Switch your profile and deploy the stacks your tools need without asking',
  )
  .option('-v, --verbose', "Show Ansible's own output", false)
  .option(
    '--dry-run',
    'Show what would install and the values your tools need, without running anything',
    false,
  )
  .action(async (name: string | undefined, options: InstallOptions) => {
    const installed = await runInstall(name, options)
    // Last, in green, in place of "Done"
    if (installed) {
      closeFrameWithCallout(
        'success',
        describeInstalled(installed).join('\n'),
        {
          tinted: true,
        },
      )
    }
  })
