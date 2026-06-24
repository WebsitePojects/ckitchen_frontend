import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface PageHeaderState {
  title: string
  subtitle?: string
}

interface PageHeaderContextValue extends PageHeaderState {
  setHeader: (state: PageHeaderState) => void
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null)

/**
 * Lets a page (rendered inside <Outlet/>) push its title/subtitle up to the
 * Topbar without prop-drilling through the router. Pages call usePageHeader()
 * once near the top of their render.
 */
export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState>({ title: 'CloudKitchen ONE' })

  const value = useMemo<PageHeaderContextValue>(
    () => ({ ...state, setHeader: setState }),
    [state],
  )

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>
}

export function usePageHeaderContext(): PageHeaderContextValue {
  const ctx = useContext(PageHeaderContext)
  if (!ctx) throw new Error('usePageHeaderContext must be used inside <PageHeaderProvider>')
  return ctx
}

/** Call from a page component to set the Topbar title/subtitle for the current route. */
export function usePageHeader(title: string, subtitle?: string) {
  const { setHeader } = usePageHeaderContext()
  // Intentionally not using useEffect deps array tricks here — pages call this
  // once per render with stable strings; React Router unmounts pages on nav
  // so there is no stale-title flash between routes.
  useMemo(() => {
    setHeader({ title, subtitle })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle])
}
