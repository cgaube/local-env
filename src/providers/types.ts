export type UpdateOptions = { yes: boolean; dryRun: boolean }

// A provider installs one kind of content from the sources, through its own
// app (Dockhand for docker/, Semaphore for ansible/)
export type Provider = {
  name: string
  // Starts the provider's app and points it at every source. Idempotent: runs
  // on every start and after sources change.
  provision: () => Promise<void>
  // Brings installed content up to date. Returns summary lines for `update`.
  update: (options: UpdateOptions) => Promise<string[]>
}
