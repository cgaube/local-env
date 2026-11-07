import { createFileRoute } from '@tanstack/react-router'
import { ProfilesPage } from '#ui/features/profiles/profiles-page'

export const Route = createFileRoute('/profiles')({ component: ProfilesPage })
