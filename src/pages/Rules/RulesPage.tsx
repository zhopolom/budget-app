import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { EmptyState } from '../../components/EmptyState/EmptyState'
import { ListCard, ListItem, ListRow } from '../../components/ListRow/ListRow'
import { PageHeader } from '../../components/PageHeader/PageHeader'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import { MISSING_CATEGORY } from '../../features/categories/defaults'
import { RULE_MATCH_TYPE_LABELS } from '../../features/rules/matching'
import { categoryRulesRepository } from '../../features/rules/repository'
import type { Category, CategoryRule, Id } from '../../types/entities'
import { RuleForm } from './RuleForm'
import styles from './RulesPage.module.css'
import { useRulesData } from './useRulesData'

type SheetState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; id: Id }

function subtitleFor(rule: CategoryRule, categories: readonly Category[]): string {
  const category = categories.find((item) => item.id === rule.categoryId)
  const parts = [`${RULE_MATCH_TYPE_LABELS[rule.matchType]} «${rule.pattern}» → ${category?.name ?? MISSING_CATEGORY.name}`]
  if (!rule.enabled) parts.push('выключено')
  return parts.join(' · ')
}

export function RulesPage() {
  const data = useRulesData()
  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' })
  const toast = useToast()
  const confirm = useConfirm()

  const close = () => setSheet({ kind: 'closed' })
  const current = sheet.kind === 'edit' ? data?.rules.find((rule) => rule.id === sheet.id) : undefined
  const isOpen = sheet.kind === 'create' || current !== undefined

  const remove = async (rule: CategoryRule) => {
    const confirmed = await confirm({
      title: 'Удалить правило?',
      message: 'Операции, которые оно уже разложило по категориям, останутся как есть.',
      confirmLabel: 'Удалить',
      tone: 'danger',
    })
    if (!confirmed) return
    await categoryRulesRepository.remove(rule.id)
    close()
    toast.show('Правило удалено')
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Правила категорий" backTo="/settings" />

      <p className={styles.note}>
        Правила подставляют категорию по описанию при импорте из CSV. Прошлые операции они не меняют — только
        показывают, сколько бы подошло.
      </p>

      {data && data.rules.length === 0 && (
        <div className={styles.card}>
          <EmptyState
            icon="🏷️"
            title="Правил пока нет"
            text="Например: описание содержит «Spotify» → Подписки. Регистр и лишние пробелы не важны."
            action={<Button onClick={() => setSheet({ kind: 'create' })}>Добавить правило</Button>}
          />
        </div>
      )}

      {data && data.rules.length > 0 && (
        <>
          <ListCard label="Правила категорий">
            {data.rules.map((rule) => (
              <ListItem key={rule.id}>
                <ListRow
                  icon={data.categories.find((item) => item.id === rule.categoryId)?.icon ?? MISSING_CATEGORY.icon}
                  title={rule.name}
                  subtitle={subtitleFor(rule, data.categories)}
                  value={<span className={styles.priority}>{rule.priority}</span>}
                  onClick={() => setSheet({ kind: 'edit', id: rule.id })}
                />
              </ListItem>
            ))}
          </ListCard>
          <p className={styles.hint}>Число справа — приоритет: при нескольких подходящих правилах побеждает большее.</p>
          <Button variant="secondary" block onClick={() => setSheet({ kind: 'create' })}>
            Добавить правило
          </Button>
        </>
      )}

      <Sheet open={isOpen} onClose={close} title={sheet.kind === 'create' ? 'Новое правило' : 'Правило'}>
        {data && (
          <div key={sheet.kind === 'edit' ? sheet.id : 'create'}>
            {sheet.kind === 'create' && <RuleForm rule={null} data={data} onDone={close} />}
            {current && <RuleForm rule={current} data={data} onDone={close} onDelete={() => void remove(current)} />}
          </div>
        )}
      </Sheet>
    </div>
  )
}
