/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from 'react'

const ActiveHostContext = createContext<{
  host: string
  setHost: (host: string) => void
}>({ host: '__default__', setHost: () => {} })

export function ActiveHostProvider({ children }: { children: React.ReactNode }) {
  const [host, setHostState] = useState(() => localStorage.getItem('activeHost') || '__default__')

  const setHost = (next: string) => {
    const value = next || '__default__'
    setHostState(value)
    localStorage.setItem('activeHost', value)
  }

  return <ActiveHostContext.Provider value={{ host, setHost }}>{children}</ActiveHostContext.Provider>
}

export function useActiveHost() {
  return useContext(ActiveHostContext)
}
