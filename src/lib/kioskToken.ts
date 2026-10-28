/**
 * The token that pairs THIS screen to a workspace as an attendance kiosk (D56). Issued when an
 * owner opens Attendance > Public kiosk; sent as X-Kiosk-Token on /public/* calls. It is a
 * device credential, not a person's session, so it stays on the screen across sign-outs.
 */
const STORAGE_KEY = 'orion.kioskToken'

export function getKioskToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setKioskToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Storage blocked (private window): the kiosk will ask to be set up again.
  }
}
