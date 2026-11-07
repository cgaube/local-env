import { createFileRoute } from '@tanstack/react-router'
import { CatalogPage } from '#ui/features/tools/catalog-page'

export const Route = createFileRoute('/tools')({ component: CatalogPage })
