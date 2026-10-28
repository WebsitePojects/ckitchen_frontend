import { AlertTriangle } from 'lucide-react'
import type { StockShortfall } from '../lib/socket'
import { formatStockQty, perServingText, shortBy } from '../lib/stockShortfall'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

/**
 * Blocking prompt when an order needs more stock than the kitchen has (409 INSUFFICIENT_STOCK).
 * It is a decision, not a notice: edit the order, or (managers only) send it anyway. Each line
 * says what is short, by how much, and which item needs it per serving, in real units.
 *
 * The parent owns the request: `onSendAnyway` is its submit-guarded handler, and while it is
 * pending the dialog cannot be dismissed or confirmed twice.
 */
export default function StockShortfallDialog({
  shortfalls,
  canOversell,
  pending,
  onSendAnyway,
  onClose,
}: {
  shortfalls: StockShortfall[] | null
  canOversell: boolean
  pending: boolean
  onSendAnyway: () => void
  onClose: () => void
}) {
  const open = !!shortfalls && shortfalls.length > 0
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center sm:items-start sm:text-left">
          <span className="relative mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-warn-text" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-amber-500/25 motion-safe:animate-ping [animation-iteration-count:2]" />
            <AlertTriangle className="relative h-5 w-5" />
          </span>
          <DialogTitle>Not enough stock for this order</DialogTitle>
          <DialogDescription>
            {canOversell
              ? 'The kitchen is short of the items below. Edit the order, or send it anyway and restock soon.'
              : 'The kitchen is short of the items below. Edit the order, or ask a manager to send it anyway.'}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border border-y border-border" aria-label="Short ingredients">
          {(shortfalls ?? []).map((s) => (
            <li key={s.ingredient_id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium text-foreground">{s.ingredient_name}</p>
                <p className="text-sm font-semibold tabular-nums text-danger-text">short {formatStockQty(shortBy(s), s.unit)}</p>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">
                Needs {formatStockQty(s.required, s.unit)} · kitchen has {formatStockQty(s.available, s.unit)}
              </p>
              {s.used_by?.map((use) => (
                <p key={use.menu_item_id} className="text-xs tabular-nums text-muted-foreground">
                  {perServingText(use, s.unit)}
                </p>
              ))}
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={pending} autoFocus>
            Edit order
          </Button>
          {canOversell && (
            <Button variant="destructive" onClick={onSendAnyway} disabled={pending} aria-busy={pending}>
              {pending ? 'Sending…' : 'Send anyway'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
