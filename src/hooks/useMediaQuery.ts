import { useSyncExternalStore } from 'react'

/**
 * Live result of a CSS media query (e.g. Tailwind's `xl` = '(min-width: 1280px)').
 * Use it when JS must agree with a CSS breakpoint: a Radix Sheet/Dialog whose content is
 * hidden with `xl:hidden` still renders its modal overlay, so its `open` must follow the
 * same breakpoint or the page dims and stops taking clicks.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
