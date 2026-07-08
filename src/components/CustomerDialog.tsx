/**
 * CustomerDialog — create / edit a customer (Master Data). Same layout as
 * SupplierDialog minus the "Items supplied" section (customers don't supply
 * inventory). Replaces the old cramped inline row form (client review
 * 2026-07-08).
 *
 * Backend contract (ckitchen_backend/src/modules/master/routes.ts — the
 * supplier/customer party tables share one schema):
 *   POST  /customers      { code, name, contact_name?, contact_phone?, email?,
 *                           address?, payment_term_days? } → 201 row
 *   PATCH /customers/:id  { name?, contact_name?, contact_phone?, email?,
 *                           address?, payment_term_days?, is_active? } → 200 row
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { patch, post } from '../lib/api'
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
import type { Party } from './SupplierDialog'

interface CustomerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create mode; a row = edit mode. */
  customer: Party | null
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

export default function CustomerDialog({ open, onOpenChange, customer }: CustomerDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = customer !== null

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
    setCode(customer?.code ?? '')
    setName(customer?.name ?? '')
    setContactName(customer?.contactName ?? '')
    setContactPhone(customer?.contactPhone ?? '')
    setEmail(customer?.email ?? '')
    setAddress(customer?.address ?? '')
    setPaymentTermDays(
      customer && customer.paymentTermDays ? String(customer.paymentTermDays) : '',
    )
    setIsActive(customer?.isActive ?? true)
    setSaving(false)
  }, [open, customer])

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
        await patch(`/customers/${customer.id}`, {
          name: name.trim(),
          contact_name: contactName.trim() || null,
          contact_phone: contactPhone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          payment_term_days: paymentTermDays !== '' ? Number(paymentTermDays) : 0,
          is_active: isActive,
        })
        toast.success(`Customer ${code.toUpperCase()} updated.`)
      } else {
        const res = await post<Party>('/customers', {
          code: code.trim(),
          name: name.trim(),
          contact_name: contactName.trim() || undefined,
          contact_phone: contactPhone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          payment_term_days: paymentTermDays !== '' ? Number(paymentTermDays) : undefined,
        })
        toast.success(`Customer ${res.data.code} created.`)
      }
      void queryClient.invalidateQueries({ queryKey: ['masterdata', 'customers'] })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save customer.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="bg-[#121A17] border-[#1F2A24] text-zinc-50 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-50">
            {isEdit ? `Edit customer — ${customer.name}` : 'Add customer'}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {isEdit
              ? 'Update this customer’s contact details and status.'
              : 'Create a customer record for sales and receivables.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Code *">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={32}
                required
                disabled={isEdit}
                placeholder="e.g. CUS-001"
                className={`${INPUT_CLS} font-mono uppercase disabled:opacity-60`}
              />
            </Field>
            <Field label="Name *">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
                placeholder="e.g. Araneta Food Hall"
                className={INPUT_CLS}
              />
            </Field>
            <Field label="Contact name">
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Juan Dela Cruz"
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
                placeholder="billing@customer.ph"
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
                placeholder="e.g. 15"
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
                  id="customer-active"
                  aria-label="Customer active"
                />
                <label htmlFor="customer-active" className="text-sm text-zinc-300">
                  Active
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
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save customer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
