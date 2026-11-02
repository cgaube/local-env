import type { Service, Source } from '#ui/features/live-data/live-data.ts'
import { tone } from '#ui/features/status/tone.ts'
import { plural } from '#ui/lib/plural.ts'

// What each app installs, by source folder
const CONTENT_WORDS = { docker: 'template', ansible: 'role' } as const
type Content = keyof typeof CONTENT_WORDS

const isContent = (content: string | null): content is Content =>
  content !== null && Object.hasOwn(CONTENT_WORDS, content)

// What an app can install from the sources: "3 templates from 1 source"
export const appContent = (content: string | null, sources: Source[]) => {
  if (!isContent(content)) return null
  const word = CONTENT_WORDS[content]
  const using = sources.filter((source) => source[content] > 0)
  const total = using.reduce((sum, source) => sum + source[content], 0)
  return total
    ? `${plural(total, word)} from ${plural(using.length, 'source')}`
    : `No ${word}s in the sources yet`
}

// "5 running", or which ones are down
export const servicesSummary = (services: Service[]) => {
  if (!services.length) return 'Not running: run `local-env start`'
  const down = services.filter((service) => tone(service.state) !== 'ok')
  return down.length
    ? `${down.length} of ${services.length} not running: ${down.map((service) => service.service).join(', ')}`
    : `${services.length} running`
}
