import type { OutletSummary } from '../../context/OutletContext'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/** Dropdown checklist of outlets, used by the New User and join-link forms. */
export default function OutletMultiSelect({
  outlets,
  selected,
  onChange,
  disabled,
}: {
  outlets: OutletSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  const label =
    outlets.length === 0
      ? 'No outlets configured'
      : selected.length === 0
        ? 'No outlet access'
        : selected.length === outlets.length
          ? 'All outlets'
          : `${selected.length} outlet${selected.length === 1 ? '' : 's'}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          disabled={disabled || outlets.length === 0}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>Outlet access</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {outlets.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={selected.includes(o.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.id)}
          >
            {o.name} <span className="ml-1 text-xs text-muted-foreground">({o.code})</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
