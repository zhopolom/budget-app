import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { Sheet } from '../../components/Sheet/Sheet'
import { useCategories } from '../../features/categories/useCategories'
import type { CategoryType, Id } from '../../types/entities'
import styles from './CategoriesPage.module.css'
import { CategoryForm } from './CategorySheet'
import { DeleteCategoryPanel } from './DeleteCategoryPanel'

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
] as const satisfies readonly { value: CategoryType; label: string }[]

type SheetState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; id: Id } | { kind: 'delete'; id: Id }

const SHEET_TITLES = { create: 'Новая категория', edit: 'Категория', delete: 'Удаление категории' } as const

export function CategoriesPage() {
  const categories = useCategories()
  const [type, setType] = useState<CategoryType>('expense')
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })

  const close = () => setSheet({ kind: 'closed' })

  const visible = categories?.filter((category) => category.type === type) ?? []
  // Свои категории — сверху: их пользователь чаще всего и ищет на этом экране
  const custom = visible.filter((category) => !category.isSystem)
  const system = visible.filter((category) => category.isSystem)

  // Категорию берём из живых данных: удалённая закрывает шторку сама
  const current =
    sheet.kind === 'edit' || sheet.kind === 'delete' ? categories?.find((item) => item.id === sheet.id) : undefined
  const isOpen = sheet.kind === 'create' || current !== undefined

  return (
    <div className={styles.page}>
      <PageHeader title="Категории" backTo="/settings" />

      <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={setType} label="Тип категорий" />

      <Button variant="secondary" block onClick={() => setSheet({ kind: 'create' })}>
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
                  onClick={() => setSheet({ kind: 'edit', id: category.id })}
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

      <Sheet open={isOpen} onClose={close} title={sheet.kind === 'closed' ? '' : SHEET_TITLES[sheet.kind]}>
        {/* key: при смене режима внутри открытой шторки форма стартует заново */}
        <div key={sheet.kind === 'create' ? 'create' : `${sheet.kind}-${current?.id}`}>
          {sheet.kind === 'create' && (
            <CategoryForm category={null} type={type} existing={categories ?? []} onDone={close} />
          )}

          {sheet.kind === 'edit' && current && (
            <CategoryForm
              category={current}
              type={type}
              existing={categories ?? []}
              onDone={close}
              onDelete={() => setSheet({ kind: 'delete', id: current.id })}
            />
          )}

          {sheet.kind === 'delete' && current && (
            <DeleteCategoryPanel
              category={current}
              candidates={(categories ?? []).filter(
                (candidate) => candidate.type === current.type && candidate.id !== current.id,
              )}
              onCancel={() => setSheet({ kind: 'edit', id: current.id })}
              onDone={close}
            />
          )}
        </div>
      </Sheet>
    </div>
  )
}
