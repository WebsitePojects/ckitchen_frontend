import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export interface InviteLinkInfo {
  name: string
  email: string
  url: string
}

/**
 * Shows a staff member's private sign-up link after an invite, so the owner can send it by
 * Messenger/Viber when the invitation email does not arrive. The link only works for that
 * email address, so it is shown once here and never stored by the page.
 */
export default function InviteLinkDialog({ invite, onClose }: { invite: InviteLinkInfo | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the field stays selectable.
      setCopied(false)
    }
  }

  return (
    <Dialog open={invite !== null} onOpenChange={(open) => { if (!open) { setCopied(false); onClose() } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invitation for {invite?.name}</DialogTitle>
          <DialogDescription>
            An email went to <span className="font-medium text-foreground">{invite?.email}</span>. If it does not arrive,
            send them this link by Messenger or Viber. It signs up that email address only.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={invite?.url ?? ''} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
          <Button type="button" onClick={() => void copy()} className="shrink-0">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
