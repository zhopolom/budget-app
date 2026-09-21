import { db } from '../db/database'

/** Свежая база со значениями по умолчанию (Карта, Наличные, категории, настройки). */
export async function resetTestDatabase(): Promise<void> {
  db.close()
  await db.delete()
  await db.open()
}
