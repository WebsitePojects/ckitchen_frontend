import { cn } from '../../lib/utils'

interface BrandLike {
  name: string
  color?: string | null
}

interface BrandChipProps {
  brand: BrandLike | null | undefined
  className?: string
}

/** Per-brand chip — uses the API-provided brand.color (data-driven, not a fixed palette). */
export default function BrandChip({ brand, className }: BrandChipProps) {
  const color = brand?.color ?? '#71717A' // zinc-500 fallback
  return (
    <span
      className={cn(
        'inline-flex max-w-[12rem] items-center truncate whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white',
        className,
      )}
      style={{ backgroundColor: color }}
      title={brand?.name ?? 'Unknown Brand'}
    >
      {brand?.name ?? 'Unknown Brand'}
    </span>
  )
}
