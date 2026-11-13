import { join, resolve } from 'path'
import {
  type BootstrapPlan,
  listBootstrapPlans,
  planBootstrap,
} from '#services/dashboard/bootstrap.js'
import { readSourceManifest } from '#services/dashboard/source-manifest.js'
import { readVariables, type Role } from '#services/dashboard/tools.js'
import { HOME_DIR } from '#cli/core/paths.js'
import { SOURCES_DIR } from '#cli/sources/sources.js'

// The bootstraps of the added sources, as services/dashboard/bootstrap.ts
// plans them: resolved, checked and hashed with the saved values of their
// inputs. Reads only. bootstrap.ts runs them. Not tools.ts's TOOLS_DIR: it
// imports this file.

const TOOLS_DIR = resolve(HOME_DIR, 'volumes/tools')

export type { BootstrapPlan }

// The bootstraps of every source that has one
export const listBootstraps = (catalog: Role[]) =>
  listBootstrapPlans(SOURCES_DIR, catalog, readVariables(TOOLS_DIR))

// The bootstrap of an added source, or null without one
export const sourceBootstrap = (catalog: Role[], source: string) =>
  listBootstraps(catalog).find((plan) => plan.source === source) ?? null

// The roles every bootstrap lists: wanted like the profile and the picks,
// so an install doesn't forget them
export const bootstrapRoots = (catalog: Role[]) =>
  listBootstraps(catalog).flatMap(({ roles }) => roles)

// For `sources add`: throws an Error that lists what stops the bootstrap of
// this source. Reads the manifest itself, so a manifest that is not valid
// says why.
export const checkBootstrap = (catalog: Role[], source: string) => {
  const manifest = readSourceManifest(join(SOURCES_DIR, source))
  const plan = planBootstrap(catalog, source, manifest?.bootstrap ?? [])
  if (plan && plan.problems.length > 0) {
    throw new Error(plan.problems.join('\n'))
  }
}

// "Granted, VPN client"
export const describeRoles = ({ roles }: BootstrapPlan) =>
  roles.map(({ label }) => label).join(', ')
