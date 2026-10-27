import type { ReactNode } from 'react'
import { AUTH_ART, PLATFORM_ATTRIBUTION, PLATFORM_NAME } from '../../lib/branding'
import Wordmark from '../brand/Wordmark'
import ThemeToggle from '../layout/ThemeToggle'

/**
 * Layout shared by sign-in and sign-up.
 *
 * Phone and tablet: one column (mark, title, form). Laptop and up: a brand panel with the
 * optional artwork (AUTH_ART) beside the form. Every size comes from the scale in index.css,
 * so the page grows on a 1920 px monitor instead of leaving a small form in empty space.
 */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const year = new Date().getFullYear()
  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <aside className="relative isolate hidden flex-col justify-between overflow-hidden border-r border-border bg-card p-ws-section lg:flex">
        {AUTH_ART && (
          <>
            <div className="auth-art-light absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${AUTH_ART.light})` }} aria-hidden />
            <div className="auth-art-dark absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${AUTH_ART.dark})` }} aria-hidden />
            {/* Keeps the copy readable over any artwork (4.5:1 on the text side). */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-card via-card/70 to-card/20" aria-hidden />
          </>
        )}
        <Wordmark />
        <div className="max-w-lg">
          <p className="text-ws-display font-semibold tracking-tight text-foreground">
            Every brand and outlet, on one screen.
          </p>
          <p className="mt-3 text-ws-body text-muted-foreground">
            Orders from GrabFood, foodpanda and the counter, kitchen tickets, stock and staff time, in one place.
          </p>
        </div>
        <p className="text-ws-micro text-muted-foreground">
          © {year} {PLATFORM_ATTRIBUTION}
        </p>
      </aside>

      <main className="flex min-h-dvh flex-col px-ws-gutter py-ws-gap">
        <header className="flex items-center justify-between">
          <Wordmark className="lg:invisible" />
          <ThemeToggle />
        </header>

        <div className="mx-auto flex w-full max-w-ws-form flex-1 flex-col justify-center py-ws-section">
          <h1 className="text-ws-title font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1.5 text-ws-small text-muted-foreground">{subtitle}</p>
          <div className="mt-ws-gutter">{children}</div>
        </div>

        <footer className="pb-1 text-center text-ws-micro text-muted-foreground lg:hidden">
          {PLATFORM_NAME} · {PLATFORM_ATTRIBUTION}
        </footer>
      </main>
    </div>
  )
}
