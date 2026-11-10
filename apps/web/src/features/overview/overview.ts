import type { Service } from '#ui/features/live-data/live-data.ts'
import { tone } from '#ui/features/status/tone.ts'

// "5 running", or which ones are down
export const servicesSummary = (services: Service[]) => {
  if (!services.length) return 'Not running: run `local-env start`'
  const down = services.filter((service) => tone(service.state) !== 'ok')
  return down.length
    ? `${down.length} of ${services.length} not running: ${down.map((service) => service.service).join(', ')}`
    : `${services.length} running`
}
