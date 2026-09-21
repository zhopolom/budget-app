/** pluralRu(5, ['день', 'дня', 'дней']) → 'дней' */
export function pluralRu(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const n = Math.abs(count) % 100
  const last = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}
