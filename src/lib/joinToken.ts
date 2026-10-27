/**
 * A workspace join link looks like `/join#<link id>.<signature>`. The token rides in the URL
 * fragment so it never reaches a server log or a Referer header, and it is moved to
 * sessionStorage on arrival because Google sign-in redirects away and back, and Clerk uses
 * the fragment for its own routing.
 */
const STORAGE_KEY = 'orion.joinToken'
const TOKEN_FRAGMENT = /^#([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{20,100})$/i

/** Builds the link an owner sends. */
export function joinLinkUrl(token: string): string {
  return `${window.location.origin}/join#${token}`
}

/** Moves a token from the address bar into this tab's storage and clears it from the URL. */
export function captureJoinTokenFromUrl(): void {
  const match = TOKEN_FRAGMENT.exec(window.location.hash)
  if (!match) return
  try {
    sessionStorage.setItem(STORAGE_KEY, match[1]!)
  } catch {
    // Storage blocked (private mode): the token is lost after a redirect; the page says so.
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

export function pendingJoinToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearJoinToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // nothing stored
  }
}
