import { createFileRoute } from '@tanstack/react-router'
import { DockerPage, type DockerTab } from '#ui/features/docker/docker-page'

export const Route = createFileRoute('/docker')({
  component: DockerPage,
  // Templates by default: no tab in the address
  validateSearch: (search: Record<string, unknown>): { tab?: DockerTab } =>
    search.tab === 'routes' ? { tab: 'routes' } : {},
})
