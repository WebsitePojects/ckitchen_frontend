import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2, MonitorSmartphone } from 'lucide-react'
import { get, post } from '../../lib/api'
import { getKioskToken, setKioskToken } from '../../lib/kioskToken'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

/** Mirrors GET /kiosk-devices (ckitchen_backend src/modules/kiosk/routes.ts). */
interface KioskScreen {
  id: string
  name: string
  createdAt: string
  revokedAt: string | null
}

const KIOSK_SCREENS_KEY = ['kiosk-devices'] as const

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

/**
 * "Public kiosk": pairs THIS screen to the owner's workspace, then opens the kiosk. A screen
 * that is already paired keeps its pairing (the server reuses a still-valid token).
 */
export function OpenKioskButton() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pairing, setPairing] = useState(false)
  const pairingRef = useRef(false)
  // One id per press: a retry after a timeout replays the same pairing on the server.
  const requestId = useRef<string>(crypto.randomUUID())

  async function openKiosk() {
    if (pairingRef.current) return
    pairingRef.current = true
    setPairing(true)
    try {
      const { data } = await post<{ token: string }>('/kiosk-devices/pair', {
        name: `Kiosk screen ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
        request_id: requestId.current,
        ...(getKioskToken() ? { existing_token: getKioskToken() } : {}),
      })
      setKioskToken(data.token)
      requestId.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: KIOSK_SCREENS_KEY })
      navigate('/kiosk/attendance')
    } catch (err) {
      toast.error(errMsg(err, 'Could not set up this screen as a kiosk.'))
    } finally {
      pairingRef.current = false
      setPairing(false)
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={pairing} onClick={() => void openKiosk()}>
      {pairing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <MonitorSmartphone className="mr-2 h-4 w-4" aria-hidden />}
      Public kiosk
    </Button>
  )
}

/** Paired kiosk screens with Revoke, for a lost or replaced tablet. */
export function KioskScreensPanel() {
  const queryClient = useQueryClient()
  const { data: screens = [], isLoading, error } = useQuery({
    queryKey: KIOSK_SCREENS_KEY,
    queryFn: async () => (await get<KioskScreen[]>('/kiosk-devices')).data,
  })
  const revokingIds = useRef<Set<string>>(new Set())
  const [revokingId, setRevokingId] = useState<string | null>(null)

  async function revoke(screen: KioskScreen) {
    if (revokingIds.current.has(screen.id)) return
    revokingIds.current.add(screen.id)
    setRevokingId(screen.id)
    try {
      await post(`/kiosk-devices/${screen.id}/revoke`)
      toast.success(`${screen.name} can no longer be used as a kiosk`)
      void queryClient.invalidateQueries({ queryKey: KIOSK_SCREENS_KEY })
    } catch (err) {
      toast.error(errMsg(err, 'Could not revoke the screen.'))
    } finally {
      revokingIds.current.delete(screen.id)
      setRevokingId(null)
    }
  }

  const active = screens.filter((s) => !s.revokedAt)
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base text-foreground">Kiosk screens</CardTitle>
        <p className="text-ws-small text-muted-foreground">
          Tablets set up as the public time clock for this business. Revoke one that is lost or replaced.
        </p>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">Loading screens…</p>
        ) : error ? (
          <p className="px-6 pb-4 text-sm text-danger-text">{errMsg(error, 'Failed to load kiosk screens.')}</p>
        ) : active.length === 0 ? (
          <p className="px-6 pb-4 text-sm text-muted-foreground">No kiosk screens yet. Use Public kiosk on the tablet you want to use.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {active.map((screen) => (
              <li key={screen.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{screen.name}</p>
                  <p className="text-xs text-muted-foreground">Set up {fmtDate(screen.createdAt)}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger-text"
                  disabled={revokingId === screen.id}
                  onClick={() => void revoke(screen)}
                >
                  {revokingId === screen.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
