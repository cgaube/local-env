import { createContext, use, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createLiveDataStore } from '../live-data.ts'
import type { LiveDataStore } from '../live-data.ts'

const LiveDataContext = createContext<LiveDataStore | null>(null)

// Tests pass a store fed by a fake EventSource
export function LiveDataProvider({
  store,
  children,
}: {
  store?: LiveDataStore
  children: ReactNode
}) {
  const [value] = useState(() => store ?? createLiveDataStore())
  return <LiveDataContext value={value}>{children}</LiveDataContext>
}

export function useLiveData() {
  const store = use(LiveDataContext)
  if (!store)
    throw new Error('useLiveData must be used within LiveDataProvider')
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
