import { createFileRoute } from '@tanstack/react-router'
import { RoutesPage } from '#ui/features/routes/routes-page'

export const Route = createFileRoute('/docker')({ component: RoutesPage })
