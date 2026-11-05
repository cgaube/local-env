import { Command } from 'commander'
import { wantedRoles } from '#services/dashboard/role-graph.js'
import type { Role } from '#services/dashboard/tools.js'
import { readConfig } from '#cli/core/config.js'
import {
  describeProfile,
  findProfile,
  forgetUnwanted,
  listCatalog,
  listProfiles,
  readPickedTools,
  readSavedProfile,
  runPlaybook,
  saveProfile,
  unpickTools,
} from '#cli/core/tools.js'
import {
  deployRequiredStacks,
  planRequiredStacks,
} from '#cli/providers/docker/required-stacks.js'
import type { PlaybookSummary } from '#cli/core/playbook-output.js'
import { hasCommand, logger } from '#cli/utils/index.js'
import { closeFrameWithCallout } from '#cli/utils/logger.js'
import { askConfirm, askSelect, canAsk } from '#cli/utils/prompt.js'

// At the end of the output, where it is seen: just before the summary
// Tools only: a profile is a set of tools, not one more, and switching
// profiles is no news. By label, as the dashboard shows them; one gone from
// the sources by its name.
const showForgotten = (forgotten: string[], catalog: Role[]) => {
  const byId = new Map(catalog.map((role) => [role.id, role]))
  const tools = forgotten.flatMap((id) => {
    const role = byId.get(id)
    if (role?.isProfile) return []
    return [role?.label ?? id.split('/').slice(1).join('/')]
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

// Tools are picked in the dashboard, which can't run anything on the Mac:
// this runs what was picked, with the profile. A profile named here, or
// picked in the select when there is nothing to install, is saved as yours,
// unless --no-save.
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
  .action(
    async (
      name: string | undefined,
      options: {
        save: boolean
        verbose: boolean
        yes?: boolean
      },
    ) => {
      let forgotten: string[] = []
      let catalog: Role[] = []
      try {
        catalog = listCatalog()
        const saved = readSavedProfile(catalog)
        if (saved.gone) {
          logger.warn(
            `Your profile, ${saved.gone}, is no longer in your sources: local-env no longer installs it.`,
          )
        }
        const { roles: picked, missing } = readPickedTools(catalog)
        if (missing.length > 0) {
          unpickTools(catalog, missing)
          logger.warn(
            `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer in your sources: unpicked. local-env doesn't uninstall: ${missing.length === 1 ? 'it stays' : 'they stay'} on this Mac.`,
          )
        }

        // Named here, or picked in the select when there is nothing else
        // to install
        const named =
          (name ? findProfile(catalog, name) : null) ??
          (!saved.profile && picked.length === 0
            ? await askProfile(catalog)
            : null)
        // Named here, another than yours: asked first, as it changes what
        // every later install runs
        if (
          name &&
          named &&
          options.save &&
          saved.profile &&
          named.id !== saved.profile.id &&
          !(await confirmSwitch(saved.profile, named, options))
        ) {
          return
        }
        if (named && options.save) saveProfile(named)
        const profile = named ?? saved.profile
        if (profile) {
          showProfile(profile, {
            saved: saved.profile,
            once: named !== null && !options.save,
            switched:
              named !== null && options.save && named.id !== saved.profile?.id,
          })
        }
        const roots = [
          ...(profile ? [profile] : []),
          ...picked.filter(({ id }) => id !== profile?.id),
        ]
        // A profile run once (--no-save) leaves the saved one wanted
        const kept = named && !options.save ? saved.profile : null
        forgotten = forgetUnwanted(catalog, [...roots, ...(kept ? [kept] : [])])
        if (roots.length === 0) {
          showNothingPicked(catalog)
          showForgotten(forgotten, catalog)
          return
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
          await deployRequiredStacks(stacks)
        }
        showForgotten(forgotten, catalog)
        // Last, in green, its counts dimmed: what the install did, in place
        // of "Done". Without a summary (--verbose), Ansible's recap says it.
        closeFrameWithCallout(
          'success',
          [
            `Installed ${ran}`,
            ...(summary ? [describeTasks(summary)] : []),
          ].join('\n'),
          { tinted: true },
        )
      } catch (error) {
        logger.error('Error installing tools:', error)
        showForgotten(forgotten, catalog)
        process.exit(1)
      }
    },
  )
