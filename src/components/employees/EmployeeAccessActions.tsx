import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Link2, Unlink } from 'lucide-react'
import { get, post, CKApiError } from '../../lib/api'
import { ACCOUNT_ROLE_LABEL } from '../../lib/accountRoles'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'

/**
 * OWNER-only controls for an employee's system access (D58): link an existing login, or
 * remove the link. Removing the link keeps the login; blocking it is a separate action in
 * Users & Roles, so a mistaken unlink never locks anyone out.
 */

interface WorkspaceLogin {
  id: string
  name: string
  email: string
  role: string
  status: string
}

interface LinkedEmployeeRow {
  id: string
  userId: string | null
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof CKApiError || e instanceof Error ? e.message || fallback : fallback
}

export function LinkLoginButton({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Link2 className="h-3 w-3" aria-hidden /> Link existing login
      </button>
      {open && <LinkLoginDialog employeeId={employeeId} employeeName={employeeName} onClose={() => setOpen(false)} />}
    </>
  )
}

function LinkLoginDialog({ employeeId, employeeName, onClose }: { employeeId: string; employeeName: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { pending, guard } = useSubmitGuard()
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loginsQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await get<WorkspaceLogin[]>('/admin/users')).data,
  })
  const employeesQuery = useQuery({
    queryKey: ['employees', 'list'],
    queryFn: async () => (await get<LinkedEmployeeRow[]>('/employees')).data,
  })
  // Logins already tied to someone are left out: the server refuses them anyway (one login,
  // one employee), and listing them only invites a 409.
  const available = useMemo(() => {
    const taken = new Set((employeesQuery.data ?? []).map((e) => e.userId).filter(Boolean))
    return (loginsQuery.data ?? []).filter((u) => !taken.has(u.id) && u.status === 'ACTIVE')
  }, [loginsQuery.data, employeesQuery.data])

  // Linking the same login twice is a server-side replay, so no idempotency key is needed.
  const submit = guard(async () => {
    if (!userId) {
      setError('Pick a login.')
      return
    }
    setError(null)
    try {
      await post(`/employees/${employeeId}/link-user`, { user_id: userId })
      toast.success(`${employeeName} is now a system user`)
      onClose()
      await queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch (e) {
      setError(errMsg(e, 'Could not link the login.'))
    }
  })

  const loading = loginsQuery.isPending || employeesQuery.isPending
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link an existing login</DialogTitle>
          <DialogDescription>
            {employeeName} will sign in with this login. Their clock-ins, activity and summary join up under one record.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading logins…</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every active login is already linked to an employee. Create a new login for {employeeName} instead.
          </p>
        ) : (
          <Select value={userId} onValueChange={setUserId} disabled={pending}>
            <SelectTrigger aria-label="Login">
              <SelectValue placeholder="Choose a login" />
            </SelectTrigger>
            <SelectContent>
              {available.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} · {u.email} · {ACCOUNT_ROLE_LABEL[u.role] ?? u.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {error && (
          <p className="text-xs text-danger-text" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={pending || !userId}>
            {pending ? 'Linking…' : 'Link login'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UnlinkLoginButton({
  employeeId,
  employeeName,
  userId,
  userEmail,
}: {
  employeeId: string
  employeeName: string
  userId: string
  userEmail: string | null
}) {
  const queryClient = useQueryClient()
  const { pending, guard } = useSubmitGuard()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Names the login being removed, so a stale page cannot unlink one linked after it loaded.
  const submit = guard(async () => {
    setError(null)
    try {
      await post(`/employees/${employeeId}/unlink-user`, { user_id: userId })
      toast.success(`${employeeName} is now staff only`, { description: 'The login still exists in Users & Roles.' })
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['employees'] })
    } catch (e) {
      setError(errMsg(e, 'Could not remove the link.'))
    }
  })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Unlink className="h-3 w-3" aria-hidden /> Unlink
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make {employeeName} staff only?</DialogTitle>
            <DialogDescription>
              The link to {userEmail ?? 'their login'} is removed. The login itself is kept and can still sign in; block it in
              Users &amp; Roles if they should lose access. Attendance history stays with the employee.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-xs text-danger-text" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void submit()} disabled={pending}>
              {pending ? 'Unlinking…' : 'Unlink login'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
