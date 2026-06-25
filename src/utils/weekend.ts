// Branch weekend-policy helpers (shared by attendance & reporting).

export interface WeekendPolicy {
  sundayOff?: boolean
  saturdayWeeks?: number[] // ordinal Saturdays that are off (1..5)
}

/** Which Saturday of the month a date is (1..5). Only meaningful for Saturdays. */
export function saturdayOrdinal(date: Date): number {
  return Math.ceil(date.getDate() / 7)
}

/** Is the given date a weekly-off under this branch policy? */
export function isWeeklyOff(weekend: WeekendPolicy | null | undefined, date: Date): boolean {
  const w = weekend || {}
  const dow = date.getDay() // 0 = Sun, 6 = Sat
  if (dow === 0) return w.sundayOff !== false
  if (dow === 6) return (w.saturdayWeeks || []).includes(saturdayOrdinal(date))
  return false
}

/** All weekly-off dates (YYYY-MM-DD) in a given month (month is 1-12). */
export function weekendDaysInMonth(weekend: WeekendPolicy | null | undefined, year: number, month: number): string[] {
  const out: string[] = []
  const days = new Date(year, month, 0).getDate()
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month - 1, d)
    if (isWeeklyOff(weekend, date)) out.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return out
}

/** Human label e.g. "Sun + 2nd, 4th Sat" / "Sun only" / "No weekly off". */
export function weekendLabel(weekend: WeekendPolicy | null | undefined): string {
  const w = weekend || {}
  const parts: string[] = []
  if (w.sundayOff !== false) parts.push('Sun')
  const ord = ['', '1st', '2nd', '3rd', '4th', '5th']
  const sats = (w.saturdayWeeks || []).slice().sort((a, b) => a - b).map((n) => ord[n]).filter(Boolean)
  if (sats.length === 5) parts.push('all Sat')
  else if (sats.length) parts.push(`${sats.join(', ')} Sat`)
  return parts.length ? parts.join(' + ') : 'No weekly off'
}
