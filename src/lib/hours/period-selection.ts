type PeriodSelectionCandidate = {
  status: 'open' | 'closed'
}

/** Spec 081 requirement 22: open first, otherwise latest by end date. */
export function pickDefaultPeriod<T extends PeriodSelectionCandidate>(
  periods: readonly T[],
  dateTo: (period: T) => string,
): T | undefined {
  const open = periods.find((period) => period.status === 'open')
  if (open) return open
  return periods.reduce<T | undefined>((latest, period) => {
    if (!latest) return period
    return dateTo(period) >= dateTo(latest) ? period : latest
  }, undefined)
}
