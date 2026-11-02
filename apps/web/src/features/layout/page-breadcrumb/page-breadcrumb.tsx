import { useRouterState } from '@tanstack/react-router'
import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#ui/components/ui/breadcrumb'
import { findPage } from '../navigation.ts'

// Docker › Routes
export function PageBreadcrumb() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const found = findPage(pathname)
  if (!found) return null
  const parts = found.section ? [found.section, found.page] : [found.page]

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {parts.map((part, index) => (
          <Fragment key={part}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {index === parts.length - 1 ? (
                <BreadcrumbPage>{part}</BreadcrumbPage>
              ) : (
                <span className="text-muted-foreground">{part}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
