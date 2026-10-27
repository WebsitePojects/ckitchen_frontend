import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's built-in scale. Register the ORION size scale
 * (tailwind.config.js `ws-*`) so `cn('h-ws-control', 'h-8')` keeps only the last height,
 * exactly as it does for built-in classes, instead of leaving both in the class list.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ['ws-control', 'ws-gutter', 'ws-gap', 'ws-section'],
      text: ['ws-micro', 'ws-small', 'ws-body', 'ws-input', 'ws-section', 'ws-figure', 'ws-title', 'ws-display'],
    },
    classGroups: {
      'max-w': [{ 'max-w': ['ws-form'] }],
    },
  },
})

/** Merge Tailwind class lists, resolving conflicting utility classes (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
