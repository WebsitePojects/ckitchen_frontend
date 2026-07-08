/**
 * SupplierDialog — create / edit a supplier (Master Data), replacing the old
 * cramped inline 4-field row form (client review 2026-07-08), plus the client's
 * explicit ask: an "Items supplied" section managing which inventory items this
 * supplier provides (multiple per supplier).
 *
 * Backend contract (ckitchen_backend/src/modules/master/routes.ts party schemas
 * + inventory/routes.ts supplier-affiliation endpoints — matched exactly):
 *   POST   /suppliers      { code, name, contact_name?, contact_phone?, email?,
 *                            address?, payment_term_days? } → 201 row
 *   PATCH  /suppliers/:id  { name?, contact_name?, contact_phone?, email?,
 *                            address?, payment_term_days?, is_active? } → 200 row
 *   GET    /ingredients    → rows embed `suppliers: [{ supplierId, name, code }]`
 *   PUT    /ingredients/:ingId/suppliers  { supplier_id, supplier_sku?, last_unit_cost? }
 *   DELETE /ingredients/:ingId/suppliers/:supplierId → 204
 *
 * CREATE flow: saving the supplier keeps the dialog OPEN and switches it into
 * edit mode for the created row, so items can be linked immediately without
 * re-opening ("save supplier then keep dialog open" option).
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Package, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { del, get, patch, post, put } from '../lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import IngredientPicker from './purchasing/IngredientPicker'
import type { Ingredient } from './purchasing/types'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Supplier/customer row as returned by GET /suppliers | /customers. */
export interface Party {
  id: string
  code: string
  name: string
  contactName: string | null
  contactPhone: string | null
  email: string | null
  address: string | null
  paymentTermDays: number
  isActive: boolean
}

interface SupplierDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create mode; a row = edit mode. */
  supplier: Party | null
}

const INPUT_CLS =
  'bg-[#0A0F0D] border-[#1F2A24] text-zinc-200 placeholder:text-zinc-600 h-9'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</label>
      {children}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SupplierDialog({ open, onOpenChange, supplier }: SupplierDialogProps) {
  const queryClient = useQueryClient()

  // In create mode this flips to the created row's id after save, switching the
  // dialog into edit mode without closing (items become linkable).
  const [editingId, setEditingId] = useState<string | null>(null)
  const isEdit = editingId !== null

  // ── Form fields ──────────────────────────────────────────────────────────
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [paymentTermDays, setPaymentTermDays] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEditingId(supplier?.id ?? null)
    setCode(supplier?.code ?? '')
    setName(supplier?.name ?? '')
    setContactName(supplier?.contactName ?? '')
    setContactPhone(supplier?.contactPhone ?? '')
    setEmail(supplier?.email ?? '')
    setAddress(supplier?.address ?? '')
    setPaymentTermDays(
      supplier && supplier.paymentTermDays ? String(supplier.paymentTermDays) : '',
    )
    setIsActive(supplier?.isActive ?? true)
    setSaving(false)
    setAddIngredientId('')
    setAddSku('')
    setAddCost('')
  }, [open, supplier]) // eslint-disable-line react-hooks/exhaustive-deps

  function invalidateSuppliers() {
    void queryClient.invalidateQueries({ queryKey: ['masterdata', 'suppliers'] })
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] }) // ['suppliers','active'] consumers
  }

  // ── Save supplier (POST create / PATCH edit) ─────────────────────────────
  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required.')
      return
    }
    if (paymentTermDays !== '') {
      const days = Number(paymentTermDays)
      if (!Number.isInteger(days) || days < 0) {
        toast.error('Payment terms must be a whole number of days ≥ 0.')
        return
      }
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error('Enter a valid email address (or leave it blank).')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await patch(`/suppliers/${editingId}`, {
          name: name.trim(),
          contact_name: contactName.trim() || null,
          contact_phone: contactPhone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          payment_term_days: paymentTermDays !== '' ? Number(paymentTermDays) : 0,
          is_active: isActive,
        })
        toast.success(`Supplier ${code.toUpperCase()} updated.`)
        invalidateSuppliers()
        onOpenChange(false)
      } else {
        const res = await post<Party>('/suppliers', {
          code: code.trim(),
          name: name.trim(),
          contact_name: contactName.trim() || undefined,
          contact_phone: contactPhone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          payment_term_days: paymentTermDays !== '' ? Number(paymentTermDays) : undefined,
        })
        toast.success(`Supplier ${res.data.code} created — you can now link the items it supplies.`)
        invalidateSuppliers()
        // Keep the dialog open in edit mode so items can be linked right away.
        setEditingId(res.data.id)
        setCode(res.data.code)
        setIsActive(res.data.isActive)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save supplier.')
    } finally {
      setSaving(false)
    }
  }

  // ── Items supplied (supplier ↔ ingredient affiliations) ──────────────────
  // Derived from GET /ingredients (each row embeds `suppliers[]`) filtered
  // client-side by this supplier's id — no extra endpoint needed.
  const { data: ingredients = [], isLoading: ingredientsLoading } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => (await get<Ingredient[]>('/ingredients')).data,
    enabled: open,
  })

  const linkedItems = isEdit
    ? ingredients.filter((i) => i.suppliers.some((s) => s.supplierId === editingId))
    : []
  const linkedIds = new Set(linkedItems.map((i) => i.id))

  const [addIngredientId, setAddIngredientId] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addCost, setAddCost] = useState('')
  const [linking, setLinking] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  function invalidateItemLinks() {
    void queryClient.invalidateQueries({ queryKey: ['ingredients'] })
    // IngredientDialog's per-ingredient affiliation lists share this data.
    void queryClient.invalidateQueries({ queryKey: ['ingredient-suppliers'] })
  }

  async function handleLinkItem() {
    if (!editingId || !addIngredientId) {
      toast.error('Select an item to link.')
      return
    }
    const costNum = Number(addCost)
    if (addCost !== '' && (!Number.isFinite(costNum) || costNum < 0)) {
      toast.error('Last unit cost must be a number ≥ 0.')
      return
    }
    setLinking(true)
    try {
      await put(`/ingredients/${addIngredientId}/suppliers`, {
        supplier_id: editingId,
        supplier_sku: addSku.trim() || undefined,
        last_unit_cost: addCost !== '' ? costNum : undefined,
      })
      toast.success('Item linked to supplier.')
      setAddIngredientId('')
      setAddSku('')
      setAddCost('')
      invalidateItemLinks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to link item.')
    } finally {
      setLinking(false)
    }
  }

  async function handleUnlinkItem(ingredientId: string, ingredientName: string) {
    if (!editingId) return
    setRemovingId(ingredientId)
    try {
      await del(`/ingredients/${ingredientId}/suppliers/${editingId}`)
      toast.success(`"${ingredientName}" unlinked.`)
      invalidateItemLinks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlink item.')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-50">
            {isEdit ? `Edit supplier — ${name || code}` : 'Add supplier'}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {isEdit
              ? 'Update contact details and manage which inventory items this supplier provides.'
              : 'Create the supplier record first — then link the items it supplies.'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Supplier fields ── */}
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code *">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={32}
                required
                disabled={isEdit}
                placeholder="e.g. SUP-001"
                className={`${INPUT_CLS} font-mono uppercase disabled:opacity-60`}
              />
            </Field>
            <Field label="Name *">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
                placeholder="e.g. Metro Poultry Trading"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Contact name">
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Maria Santos"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Contact phone">
              <Input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                maxLength={32}
                placeholder="e.g. 0917 000 0000"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={120}
                placeholder="orders@supplier.ph"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Payment terms (days)">
              <Input
                type="number"
                min="0"
                step="1"
                value={paymentTermDays}
                onChange={(e) => setPaymentTermDays(e.target.value)}
                placeholder="e.g. 30"
                className={INPUT_CLS}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={240}
                  placeholder="Street, city"
                  className={INPUT_CLS}
                />
              </Field>
            </div>
            {isEdit && (
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  id="supplier-active"
                  aria-label="Supplier active"
                />
                <label htmlFor="supplier-active" className="text-sm text-zinc-300">
                  Active{' '}
                  <span className="text-xs text-zinc-500">
                    — inactive suppliers are hidden from purchase-order pickers
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saving}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save supplier'}
            </Button>
          </div>
        </form>

        {/* ── Items supplied ── */}
        <div className="mt-1 border-t border-[#1F2A24] pt-4">
          <div className="mb-2 flex items-center gap-2">
            <Package className="h-4 w-4 text-emerald-500" aria-hidden />
            <h3 className="text-sm font-semibold text-zinc-100">Items supplied</h3>
            {isEdit && linkedItems.length > 0 && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                {linkedItems.length}
              </span>
            )}
          </div>

          {!isEdit ? (
            <p className="rounded-lg border border-dashed border-[#1F2A24] bg-[#0A0F0D] px-3 py-2.5 text-xs text-zinc-500">
              Save the supplier first, then link the inventory items it provides.
            </p>
          ) : (
            <>
              {ingredientsLoading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Loading items…
                </div>
              ) : linkedItems.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[#1F2A24] bg-[#0A0F0D] px-3 py-2.5 text-xs text-zinc-500">
                  No items linked yet — add the inventory items this supplier provides.
                </p>
              ) : (
                <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
                  {linkedItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg border border-[#1F2A24] bg-[#0A0F0D] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-200">{item.name}</p>
                        <p className="mt-0.5 text-[11px] text-zinc-500">per {item.unit}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleUnlinkItem(item.id, item.name)}
                        disabled={removingId === item.id}
                        aria-label={`Unlink ${item.name}`}
                        title="Remove from this supplier"
                        className="h-8 w-8 flex-none text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {removingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Add item row */}
              <div className="mt-3 space-y-2 rounded-lg border border-[#1F2A24] bg-[#0A0F0D]/60 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Add item
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[10rem] flex-1">
                    <label className="mb-1 block text-[11px] text-zinc-500">Ingredient</label>
                    <IngredientPicker
                      ingredients={ingredients}
                      value={addIngredientId}
                      onChange={setAddIngredientId}
                      excludeIds={linkedIds}
                      placeholder="Search ingredient…"
                    />
                  </div>
                  <div className="w-32">
                    <label className="mb-1 block text-[11px] text-zinc-500">
                      Supplier item code
                    </label>
                    <Input
                      value={addSku}
                      onChange={(e) => setAddSku(e.target.value)}
                      maxLength={64}
                      placeholder="optional"
                      className={INPUT_CLS}
                    />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-[11px] text-zinc-500">Last ₱</label>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={addCost}
                      onChange={(e) => setAddCost(e.target.value)}
                      placeholder="opt."
                      className={INPUT_CLS}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleLinkItem()}
                    disabled={linking || !addIngredientId}
                    className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60"
                  >
                    {linking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Link
                  </Button>
                </div>
                <p className="text-[11px] text-zinc-600">
                  Supplier item code — the code this supplier uses for the item on their invoices
                  (optional).
                </p>
                {ingredients.length > 0 && ingredients.length === linkedIds.size && (
                  <p className="text-[11px] text-zinc-600">
                    Every ingredient is already linked to this supplier.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
