import { Command } from 'commander'
import { execa } from 'execa'
import { wantedRoles } from '#services/dashboard/role-graph.js'
import type { Role } from '#services/dashboard/tools.js'
import { readConfig } from '#cli/core/config.js'
import {
  findProfile,
  forgetUnwanted,
  listCatalog,
  listProfiles,
  readPickedTools,
  readSavedProfile,
  runPlaybook,
  saveProfile,
  shortName,
  unpickTools,
} from '#cli/core/tools.js'
import {
  deployRequiredStacks,
  planRequiredStacks,
} from '#cli/providers/docker/required-stacks.js'
import { hasCommand, logger } from '#cli/utils/index.js'

// Last in the output, where it is seen
const showForgotten = (forgotten: string[]) => {
  if (forgotten.length === 0) return
  const one = forgotten.length === 1
  logger.callout(
    'info',
    [
      'No longer wanted, still on this Mac',
      forgotten.map((id) => id.split('/').slice(1).join('/')).join(', '),
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
  const title = once
    ? `Profile: ${profile.label}, this time only`
    : switched
      ? `Profile: ${profile.label}, now yours`
      : `Profile: ${profile.label}`
  logger.callout(
    'info',
    [
      title,
      ...(profile.description ? [profile.description] : []),
      once
        ? saved
          ? `Your profile stays ${saved.label}.`
          : 'You have no profile saved.'
        : 'Change it on the Profiles page, or with `local-env install <profile>`.',
    ].join('\n'),
    { tinted: false, padded: false },
  )
}

// Nothing to run: says where to pick, and opens the catalog
const showNothingPicked = async (catalog: Role[]) => {
  const url = `https://local-env.${readConfig().domain}/tools`
  const profiles = listProfiles(catalog)
  logger.info(
    profiles.length > 0
      ? `No profile or tool picked yet. Install a profile with \`local-env install <profile>\` (${profiles.map(shortName).join(', ')}), or pick tools in the dashboard: ${url}`
      : `No tools picked yet. Pick them in the dashboard: ${url}`,
  )
  await execa('open', [url], { reject: false })
}

// Tools are picked in the dashboard, which can't run anything on the Mac:
// this runs what was picked, with the profile. A profile named here is saved
// as yours, unless --no-save.
export const installCommand = new Command('install')
  .description(
    'Install your profile and the tools picked in the dashboard (Tools)',
  )
  .argument(
    '[profile]',
    'A profile of your sources: saved as yours, then installed',
  )
  .option('--no-save', 'Install the profile this time, without saving it')
  .option('-y, --yes', 'Deploy the stacks your tools need without asking')
  .option('-v, --verbose', "Show Ansible's own output", false)
  .action(
    async (
      name: string | undefined,
      options: { save: boolean; verbose: boolean; yes?: boolean },
    ) => {
      let forgotten: string[] = []
      try {
        const catalog = listCatalog()
        const saved = readSavedProfile(catalog)
        if (saved.gone) {
          logger.warn(
            `Your profile, ${saved.gone}, is no longer in your sources: local-env no longer installs it.`,
          )
        }
        const named = name ? findProfile(catalog, name) : null
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

        const { roles: picked, missing } = readPickedTools(catalog)
        if (missing.length > 0) {
          unpickTools(catalog, missing)
          logger.warn(
            `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer in your sources: unpicked. local-env doesn't uninstall: ${missing.length === 1 ? 'it stays' : 'they stay'} on this Mac.`,
          )
        }
        const roots = [
          ...(profile ? [profile] : []),
          ...picked.filter(({ id }) => id !== profile?.id),
        ]
        // A profile run once (--no-save) leaves the saved one wanted
        const kept = named && !options.save ? saved.profile : null
        forgotten = forgetUnwanted(catalog, [...roots, ...(kept ? [kept] : [])])
        if (roots.length === 0) {
          await showNothingPicked(catalog)
          showForgotten(forgotten)
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
        logger.success(
          summary
            ? `Installed ${ran} · ${summary.changed} changed`
            : `Installed ${ran}`,
        )
        if (stacks) {
          // Each stack says how it went, in its own group
          await deployRequiredStacks(stacks)
        }
        showForgotten(forgotten)
      } catch (error) {
        logger.error('Error installing tools:', error)
        showForgotten(forgotten)
        process.exit(1)
      }
    },
  )
