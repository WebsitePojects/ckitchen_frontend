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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${className ?? ''}`}
      style={{ backgroundColor: color }}
    >
      {brand?.name ?? 'Unknown Brand'}
    </span>
  )
}
