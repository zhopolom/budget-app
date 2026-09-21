import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { useCategories } from '../../features/categories/useCategories'
import type { Category, CategoryType } from '../../types/entities'
import styles from './CategoriesPage.module.css'
import { CategorySheet } from './CategorySheet'

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
] as const satisfies readonly { value: CategoryType; label: string }[]

type SheetState = { open: false } | { open: true; category: Category | null }

export function CategoriesPage() {
  const categories = useCategories()
  const [type, setType] = useState<CategoryType>('expense')
  const [sheet, setSheet] = useState<SheetState>({ open: false })

  const visible = categories?.filter((category) => category.type === type) ?? []
  // Свои категории — сверху: их пользователь чаще всего и ищет на этом экране
  const custom = visible.filter((category) => !category.isSystem)
  const system = visible.filter((category) => category.isSystem)

  return (
    <div className={styles.page}>
      <PageHeader title="Категории" backTo="/settings" />

      <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={setType} label="Тип категорий" />

      <Button variant="secondary" block onClick={() => setSheet({ open: true, category: null })}>
        Новая категория
      </Button>

      {custom.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Мои</h2>
          <ListCard>
            {custom.map((category) => (
              <ListItem key={category.id}>
                <ListRow
                  icon={category.icon}
                  title={category.name}
                  chevron
                  onClick={() => setSheet({ open: true, category })}
                />
              </ListItem>
            ))}
          </ListCard>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Стандартные</h2>
        <ListCard>
          {system.map((category) => (
            <ListItem key={category.id}>
              <ListRow icon={category.icon} title={category.name} />
            </ListItem>
          ))}
        </ListCard>
        <p className={styles.hint}>Стандартные категории нельзя изменить или удалить.</p>
      </section>

      <CategorySheet
        open={sheet.open}
        category={sheet.open ? sheet.category : null}
        type={type}
        existing={categories ?? []}
        onClose={() => setSheet({ open: false })}
      />
    </div>
  )
}
