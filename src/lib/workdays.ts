/**
 * Working-day helpers shared by the Employees list/forms and the Employee 360
 * profile page. The canonical day tokens mirror the backend's `work_days`
 * contract (subset of MON..SUN, min 1).
 */

export const WORK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

export type WorkDay = (typeof WORK_DAYS)[number]

export const DAY_LABEL: Record<WorkDay, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
}

/** Default schedule for a new employee (client's standard week). */
export const DEFAULT_WORK_DAYS: WorkDay[] = ['MON', 'TUE', 'WED', 'THU', 'FRI']

/** Keeps only known day tokens and orders them Mon→Sun (defensive: old deploys may send null/garbage). */
export function sanitizeWorkDays(days: unknown): WorkDay[] {
  if (!Array.isArray(days)) return []
  const set = new Set(days.filter((d): d is WorkDay => WORK_DAYS.includes(d as WorkDay)))
  return WORK_DAYS.filter((d) => set.has(d))
}

/**
 * Compact human summary: 'Mon–Fri', 'Mon–Wed, Sat', 'Every day', or '—' when
 * unknown (e.g. an employee row from a deploy that predates work_days).
 */
export function formatWorkDays(days: unknown): string {
  const sorted = sanitizeWorkDays(days)
  if (sorted.length === 0) return '—'
  if (sorted.length === 7) return 'Every day'

  const runs: string[] = []
  let runStart = 0
  const idx = (d: WorkDay) => WORK_DAYS.indexOf(d)
  for (let i = 1; i <= sorted.length; i++) {
    const contiguous = i < sorted.length && idx(sorted[i]) === idx(sorted[i - 1]) + 1
    if (!contiguous) {
      const from = sorted[runStart]
      const to = sorted[i - 1]
      if (from === to) runs.push(DAY_LABEL[from])
      else if (idx(to) - idx(from) === 1) runs.push(`${DAY_LABEL[from]}, ${DAY_LABEL[to]}`)
      else runs.push(`${DAY_LABEL[from]}–${DAY_LABEL[to]}`)
      runStart = i
    }
  }
  return runs.join(', ')
}
