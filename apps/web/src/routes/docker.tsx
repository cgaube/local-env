import { createFileRoute } from '@tanstack/react-router'
import { DockerPage } from '#ui/features/docker/docker-page'

export const Route = createFileRoute('/docker')({ component: DockerPage })
