import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { makeClients, type Clients } from './aws'

export interface Settings {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

const STORAGE_KEY = 'may-ui.settings'

export const defaultSettings: Settings = {
  endpoint: import.meta.env.VITE_MAY_ENDPOINT ?? 'http://localhost:4566',
  region: 'us-east-1',
  accessKeyId: 'test',
  secretAccessKey: 'test',
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    // Ignore corrupt settings and fall back to defaults.
  }
  return defaultSettings
}

interface SettingsContextValue {
  settings: Settings
  clients: Clients
  update: (next: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load)
  const queryClient = useQueryClient()
  const clients = useMemo(() => makeClients(settings), [settings])

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      clients,
      update(next) {
        const merged = { ...settings, ...next }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
        setSettings(merged)
        // Cached data belongs to the old endpoint or identity.
        queryClient.clear()
      },
    }),
    [settings, clients, queryClient],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}

export function useClients() {
  return useSettings().clients
}
