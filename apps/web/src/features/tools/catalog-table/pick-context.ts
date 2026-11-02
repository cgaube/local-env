import { createContext } from 'react'

// The switches' handler, for the column that renders them
export const PickContext = createContext<(id: string, on: boolean) => void>(
  () => {},
)
