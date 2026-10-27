/**
 * The one place the app asks "which bearer token do I send?".
 *
 * Two sign-in kinds exist:
 *  - Clerk (Google / email): short-lived session tokens (about 60 s) that Clerk refreshes;
 *    always fetched fresh via the getter AuthProvider registers.
 *  - ORION password login (IT break-glass): a JWT kept in localStorage.
 *
 * Deliberately import-free so lib/api.ts and lib/socket.ts can both use it without a
 * circular import. Clerk tokens are never written to storage.
 */
type TokenGetter = () => Promise<string | null>

const ORION_TOKEN_KEY = 'ck_jwt'
let clerkTokenGetter: TokenGetter | null = null

/** Registered while a Clerk session is active; null clears it on sign-out. */
export function setClerkTokenGetter(getter: TokenGetter | null): void {
  clerkTokenGetter = getter
}

export function getOrionToken(): string | null {
  try {
    return localStorage.getItem(ORION_TOKEN_KEY)
  } catch {
    return null
  }
}

/** Token for the next request: the password-login token if present, else a fresh Clerk token. */
export async function currentBearerToken(): Promise<string | null> {
  const orion = getOrionToken()
  if (orion) return orion
  if (!clerkTokenGetter) return null
  try {
    return await clerkTokenGetter()
  } catch {
    return null
  }
}
