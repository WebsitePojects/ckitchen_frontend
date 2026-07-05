/**
 * Minimal, dependency-free JWT payload decoder.
 *
 * The frontend never verifies the signature here — the backend already
 * signed/validated it, and every request re-validates the token server-side
 * (auth/middleware.ts requireAuth). This exists purely to read claims that
 * ride the JWT but are NOT echoed in the login/`/auth/me` response body —
 * namely `outlet_scope`/`outlet_ids` (tenancy, D22/W1; see backend
 * modules/auth/service.ts `AuthTokenPayload`). Deliberately not a full JWT
 * library: no signature check, no expiry logic (an expired/invalid token
 * already 401s on the next request regardless).
 */
export function decodeJwtPayload<T>(token: string): T | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
