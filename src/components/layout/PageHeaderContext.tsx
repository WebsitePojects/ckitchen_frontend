import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface PageHeaderState {
  /** Route the title belongs to; a title set on another route is ignored (no stale titles). */
  path: string
  title: string
  subtitle?: string
}

interface PageHeaderContextValue {
  header: PageHeaderState | null
  setHeader: (state: PageHeaderState) => void
  /** How many in-page <PageHeader> titles are mounted; the Topbar drops its h1 when > 0. */
  inPageTitles: number
  registerInPageTitle: () => () => void
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null)

/**
 * Lets a page push a title to the Topbar, and lets the in-page <PageHeader> claim the page's
 * single h1 so the Topbar shows only the breadcrumb.
 */
export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<PageHeaderState | null>(null)
  const [inPageTitles, setInPageTitles] = useState(0)

  const registerInPageTitle = useCallback(() => {
    setInPageTitles((n) => n + 1)
    return () => setInPageTitles((n) => n - 1)
  }, [])

  const value = useMemo<PageHeaderContextValue>(
    () => ({ header, setHeader, inPageTitles, registerInPageTitle }),
    [header, inPageTitles, registerInPageTitle],
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
  const { pathname } = useLocation()
  useEffect(() => {
    setHeader({ path: pathname, title, subtitle })
  }, [setHeader, pathname, title, subtitle])
}

/** For pages that draw their own h1 without <PageHeader>: the Topbar then shows only the breadcrumb. */
export function useInPageTitle() {
  const { registerInPageTitle } = usePageHeaderContext()
  useEffect(() => registerInPageTitle(), [registerInPageTitle])
}
