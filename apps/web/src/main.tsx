import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '#ui/components/ui/tooltip'
import { LiveDataProvider } from '#ui/features/live-data/live-data-provider'
import { ThemeProvider } from '#ui/features/theme/theme-provider'
import { router } from '#ui/router.tsx'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LiveDataProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </LiveDataProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
