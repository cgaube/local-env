import { execCompose, execDocker } from '../utils/exec.js'

// Core services whose container runs an older version of local-env than the
// files in the home folder: their compose file or their code (the
// `local-env.revision` label, src/core/revisions.ts) changed since. Compose
// stores a hash of each service's config on its container, so comparing it
// with the current one says which ones `local-env start` would recreate.
// About 50 ms. Empty when Docker isn't running or the stack is stopped.
export const findOutdatedServices = async () => {
  try {
    const [config, running] = await Promise.all([
      execCompose(['config', '--hash', '*'], { capture: true }),
      execDocker(
        [
          'ps',
          '--filter',
          'label=com.docker.compose.project=local-env',
          '--format',
          '{{.Label "com.docker.compose.service"}} {{.Label "com.docker.compose.config-hash"}}',
        ],
        { capture: true },
      ),
    ])
    const current = new Map(
      (config.stdout ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ') as [string, string]),
    )
    return (running.stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ') as [string, string])
      .filter(
        ([service, hash]) =>
          current.has(service) && current.get(service) !== hash,
      )
      .map(([service]) => service)
      .sort()
  } catch {
    return []
  }
}
