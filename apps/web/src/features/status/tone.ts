// Container states as Docker reports them, with the health when the service
// checks it: running, healthy, starting, unhealthy, exited…
export type Tone = 'ok' | 'warn' | 'bad'

export const tone = (state: string): Tone => {
  if (state === 'running' || state === 'healthy') return 'ok'
  if (state === 'starting' || state === 'restarting') return 'warn'
  return 'bad'
}
