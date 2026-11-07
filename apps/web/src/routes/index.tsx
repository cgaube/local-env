import { createFileRoute } from '@tanstack/react-router'
import { OverviewPage } from '#ui/features/overview/overview-page'

export const Route = createFileRoute('/')({ component: OverviewPage })
