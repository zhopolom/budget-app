import type { Account } from '../../types/entities'

/** Счета, на которые можно перенести операции удаляемого: любые другие в той же валюте. */
export function transferCandidates<T extends { account: Account }>(source: Account, items: readonly T[]): T[] {
  return items.filter(({ account }) => account.id !== source.id && account.currency === source.currency)
}
