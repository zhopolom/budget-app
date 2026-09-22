import { useMemo, useRef, useState } from 'react'
import { FullScreenLayout } from '../../app/FullScreenLayout'
import { goBack, navigate } from '../../app/navigation'
import { Button } from '../../components/Button/Button'
import { CategoryPicker } from '../../components/CategoryPicker/CategoryPicker'
import { ChipGroup } from '../../components/ChipGroup/ChipGroup'
import { useConfirm } from '../../components/Confirm/confirmContext'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import { Sheet } from '../../components/Sheet/Sheet'
import { useToast } from '../../components/Toast/toastContext'
import { ACCOUNT_TYPE_ICONS } from '../../features/accounts/labels'
import { MISSING_CATEGORY } from '../../features/categories/defaults'
import { decodeCsvBytes, parseCsvFile, type CsvEncoding, type ParsedCsv } from '../../features/import/csv'
import { guessMapping, isMappingComplete, type AmountMode, type ColumnMapping } from '../../features/import/mapping'
import { DATE_FORMAT_LABELS, DATE_FORMATS, type DateFormat } from '../../features/import/normalize'
import { importRepository, loadExistingFingerprints } from '../../features/import/repository'
import {
  applyRulesToRows,
  assignCategory,
  buildImportRows,
  IMPORT_LIMITS,
  IMPORT_STATUS_LABELS,
  setInclude,
  summarizeRows,
  type ImportRow,
  type ImportRowStatus,
} from '../../features/import/session'
import { compileRules } from '../../features/rules/matching'
import { useSettings } from '../../features/settings/useSettings'
import { pickDefaultAccountId } from '../../features/transactions/useTransactionEditorData'
import { useToday } from '../../hooks/useToday'
import type { Category, EntryType, Id } from '../../types/entities'
import { formatDayShort } from '../../utils/dates'
import { Money } from '../../utils/money'
import { pluralRu } from '../../utils/plural'
import { RuleForm } from '../Rules/RuleForm'
import { useRulesData } from '../Rules/useRulesData'
import styles from './ImportPage.module.css'

/** Сколько строк рисуем в превью: остальное — счётчиком и фильтрами (ТЗ §64). */
const PREVIEW_ROWS = 200

type Step =
  | { kind: 'pick' }
  | { kind: 'mapping'; file: LoadedFile; mapping: Partial<ColumnMapping>; dateFormats: DateFormat[] }
  | { kind: 'preview'; file: LoadedFile; mapping: ColumnMapping; rows: ImportRow[] }
  | { kind: 'done'; count: number; skipped: number }

interface LoadedFile {
  name: string
  encoding: CsvEncoding
  parsed: ParsedCsv
}

type RowFilter = 'all' | ImportRowStatus

const FILTER_OPTIONS: { value: RowFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'needsCategory', label: 'Без категории' },
  { value: 'duplicate', label: 'Дубли' },
  { value: 'error', label: 'Ошибки' },
]

const AMOUNT_MODE_OPTIONS = [
  { value: 'signed', label: 'Одна колонка со знаком' },
  { value: 'debitCredit', label: 'Списание и зачисление' },
] as const satisfies readonly { value: AmountMode; label: string }[]

const NONE = '__none__'

const bytesLabel = (bytes: number) => `${Math.round(bytes / 1024)} КБ`

export function ImportPage() {
  const today = useToday()
  const settings = useSettings()
  const data = useRulesData()
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [accountId, setAccountId] = useState<Id | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const currency = settings?.baseCurrency ?? 'UAH'
  const chosenAccountId = accountId ?? (data && settings ? pickDefaultAccountId(data.accounts, settings.lastAccountId) : null)
  const account = data?.accounts.find((item) => item.id === chosenAccountId)

  const close = () => goBack('/settings')

  const handleFile = async (file: File) => {
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      toast.show(`Файл больше ${bytesLabel(IMPORT_LIMITS.maxFileBytes)}: банковская выгрузка обычно в десятки раз меньше`, { tone: 'error' })
      return
    }
    const decoded = decodeCsvBytes(await file.arrayBuffer())
    const parsed = parseCsvFile(decoded.text)
    if (parsed.header.length < 2 || parsed.records.length === 0) {
      toast.show('В файле не нашлось таблицы: нужны хотя бы две колонки и одна строка данных', { tone: 'error' })
      return
    }
    if (parsed.records.length > IMPORT_LIMITS.maxRows) {
      toast.show(`Слишком много строк: ${parsed.records.length}, предел ${IMPORT_LIMITS.maxRows}`, { tone: 'error' })
      return
    }
    const guess = guessMapping(parsed.header, parsed.records)
    setStep({ kind: 'mapping', file: { name: file.name, encoding: decoded.encoding, parsed }, mapping: guess.mapping, dateFormats: guess.dateFormats })
  }

  const buildPreview = async (file: LoadedFile, mapping: ColumnMapping) => {
    if (!data || !chosenAccountId) return
    setBusy(true)
    try {
      const existing = await loadExistingFingerprints(chosenAccountId)
      const rows = buildImportRows(file.parsed.records, {
        accountId: chosenAccountId,
        mapping,
        rules: compileRules(data.rules),
        categories: data.categories,
        existingFingerprints: existing,
      })
      setStep({ kind: 'preview', file, mapping, rows })
    } finally {
      setBusy(false)
    }
  }

  const commit = async (rows: ImportRow[], fileName: string) => {
    if (!chosenAccountId || !account) return
    const summary = summarizeRows(rows)
    const confirmed = await confirm({
      title: `Импортировать ${summary.toImport} ${pluralRu(summary.toImport, ['операцию', 'операции', 'операций'])}?`,
      message:
        `Они запишутся на счёт «${account.name}».` +
        (summary.total - summary.toImport > 0
          ? ` ${summary.total - summary.toImport} ${pluralRu(summary.total - summary.toImport, ['строка', 'строки', 'строк'])} останется за бортом: дубли, ошибки и строки без категории.`
          : '') +
        ' Импорт можно отменить в настройках.',
      confirmLabel: 'Импортировать',
    })
    if (!confirmed) return

    setBusy(true)
    try {
      const history = await importRepository.commit({ fileName, accountId: chosenAccountId, rows })
      setStep({ kind: 'done', count: history.count, skipped: history.skippedCount })
      toast.show(`Импортировано ${history.count} ${pluralRu(history.count, ['операция', 'операции', 'операций'])}`)
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Не удалось импортировать', { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <FullScreenLayout title="Импорт из CSV" onClose={close}>
      {data && settings && step.kind === 'pick' && (
        <div className={styles.step}>
          <p className={styles.text}>
            Выгрузка из банка или таблицы: дата, сумма и описание в любом порядке. Файл читается на устройстве и никуда не отправляется.
          </p>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Куда записать</h2>
            <ChipGroup
              chips={data.accounts.map((item) => ({ value: item.id, label: item.name, icon: ACCOUNT_TYPE_ICONS[item.type] }))}
              value={chosenAccountId}
              onChange={setAccountId}
              label="Счёт назначения"
              layout="scroll"
            />
          </section>

          <Button block disabled={!chosenAccountId || busy} onClick={() => fileInput.current?.click()}>
            Выбрать файл CSV
          </Button>
          <p className={styles.hint}>
            До {bytesLabel(IMPORT_LIMITS.maxFileBytes)} и {IMPORT_LIMITS.maxRows.toLocaleString('ru-RU')} строк. Разделитель, кодировка и формат даты определяются сами; если формат даты неоднозначен — спросим.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="csv-file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
        </div>
      )}

      {data && step.kind === 'mapping' && (
        <MappingStep
          file={step.file}
          mapping={step.mapping}
          dateFormats={step.dateFormats}
          busy={busy}
          onChange={(mapping) => setStep({ ...step, mapping })}
          onBack={() => setStep({ kind: 'pick' })}
          onNext={(mapping) => void buildPreview(step.file, mapping)}
        />
      )}

      {data && step.kind === 'preview' && chosenAccountId && (
        <PreviewStep
          rows={step.rows}
          categories={data.categories}
          accountId={chosenAccountId}
          currency={currency}
          today={today}
          busy={busy}
          rulesData={data}
          onChange={(rows) => setStep({ ...step, rows })}
          onBack={() => setStep({ kind: 'mapping', file: step.file, mapping: step.mapping, dateFormats: [] })}
          onCommit={() => void commit(step.rows, step.file.name)}
        />
      )}

      {step.kind === 'done' && (
        <div className={styles.step}>
          <p className={styles.doneIcon} aria-hidden="true">
            ✅
          </p>
          <h2 className={styles.doneTitle}>
            Импортировано {step.count} {pluralRu(step.count, ['операция', 'операции', 'операций'])}
          </h2>
          <p className={styles.text}>
            {step.skipped > 0 ? `${step.skipped} ${pluralRu(step.skipped, ['строка пропущена', 'строки пропущены', 'строк пропущено'])}. ` : ''}
            Если что-то не так — «Настройки → Импорт из CSV → Отменить импорт» вернёт всё как было.
          </p>
          <div className={styles.actions}>
            <Button block onClick={() => navigate('/transactions', { replace: true })}>
              К операциям
            </Button>
            <Button variant="secondary" block onClick={() => setStep({ kind: 'pick' })}>
              Импортировать ещё файл
            </Button>
          </div>
        </div>
      )}
    </FullScreenLayout>
  )
}

interface MappingStepProps {
  file: LoadedFile
  mapping: Partial<ColumnMapping>
  dateFormats: DateFormat[]
  busy: boolean
  onChange: (mapping: Partial<ColumnMapping>) => void
  onBack: () => void
  onNext: (mapping: ColumnMapping) => void
}

function MappingStep({ file, mapping, dateFormats, busy, onChange, onBack, onNext }: MappingStepProps) {
  const { header, records } = file.parsed
  const update = (patch: Partial<ColumnMapping>) => onChange({ ...mapping, ...patch })
  const columnSelect = (label: string, key: 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'type' | 'category', required = false) => (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <select
        className={styles.select}
        value={mapping[key] ?? NONE}
        onChange={(event) => {
          const value = event.target.value
          update({ [key]: value === NONE ? null : Number(value) } as Partial<ColumnMapping>)
        }}
      >
        {!required && <option value={NONE}>— нет —</option>}
        {required && mapping[key] === undefined && <option value={NONE}>Выберите колонку</option>}
        {header.map((name, index) => (
          <option key={index} value={index}>
            {name || `Колонка ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  )

  const complete = isMappingComplete(mapping)
  const delimiterLabel = file.parsed.delimiter === '\t' ? 'табуляция' : file.parsed.delimiter === ';' ? 'точка с запятой' : 'запятая'

  return (
    <div className={styles.step}>
      <p className={styles.text}>
        <strong>{file.name}</strong>: {records.length} {pluralRu(records.length, ['строка', 'строки', 'строк'])}, разделитель — {delimiterLabel}, кодировка {file.encoding}.
      </p>

      <div className={styles.sample} role="table" aria-label="Первые строки файла">
        {[header, ...records.slice(0, 3)].map((row, rowIndex) => (
          <div key={rowIndex} className={styles.sampleRow} role="row" data-header={rowIndex === 0 || undefined}>
            {row.map((cell, cellIndex) => (
              <span key={cellIndex} className={styles.sampleCell} role="cell">
                {cell || '—'}
              </span>
            ))}
          </div>
        ))}
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Колонки</h2>
        {columnSelect('Дата', 'date', true)}
        {columnSelect('Описание', 'description')}
        <SegmentedControl
          options={AMOUNT_MODE_OPTIONS}
          value={mapping.amountMode ?? 'signed'}
          onChange={(amountMode) => update({ amountMode })}
          label="Как записана сумма"
        />
        {(mapping.amountMode ?? 'signed') === 'signed' ? (
          <>
            {columnSelect('Сумма', 'amount', true)}
            <label className={styles.toggle}>
              <input type="checkbox" className={styles.checkbox} checked={mapping.invertSign ?? false} onChange={(event) => update({ invertSign: event.target.checked })} />
              <span>Расходы записаны со знаком плюс</span>
            </label>
          </>
        ) : (
          <>
            {columnSelect('Списание (расход)', 'debit', true)}
            {columnSelect('Зачисление (доход)', 'credit', true)}
          </>
        )}
        {columnSelect('Тип операции', 'type')}
        {columnSelect('Категория', 'category')}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Формат даты</h2>
        {dateFormats.length > 1 && (
          <p className={styles.hint}>Даты в файле читаются двумя способами — выберите, какой правильный.</p>
        )}
        <ChipGroup
          chips={DATE_FORMATS.map((format) => ({ value: format, label: DATE_FORMAT_LABELS[format] }))}
          value={mapping.dateFormat ?? null}
          onChange={(dateFormat) => update({ dateFormat })}
          label="Формат даты"
          layout="scroll"
        />
      </section>

      <div className={styles.actions}>
        <Button block disabled={!complete || busy} onClick={() => complete && onNext(mapping)}>
          Показать превью
        </Button>
        <Button variant="ghost" block onClick={onBack} disabled={busy}>
          Другой файл
        </Button>
      </div>
    </div>
  )
}

interface PreviewStepProps {
  rows: ImportRow[]
  categories: readonly Category[]
  accountId: Id
  currency: Parameters<typeof Money.format>[1]
  today: string
  busy: boolean
  rulesData: NonNullable<ReturnType<typeof useRulesData>>
  onChange: (rows: ImportRow[]) => void
  onBack: () => void
  onCommit: () => void
}

function PreviewStep({ rows, categories, accountId, currency, today, busy, rulesData, onChange, onBack, onCommit }: PreviewStepProps) {
  const [filter, setFilter] = useState<RowFilter>('all')
  const [editingLine, setEditingLine] = useState<number | null>(null)
  const [bulkType, setBulkType] = useState<EntryType | null>(null)
  const [rulePrompt, setRulePrompt] = useState<{ description: string; categoryId: Id } | null>(null)
  const toast = useToast()

  const summary = useMemo(() => summarizeRows(rows), [rows])
  const visible = useMemo(() => (filter === 'all' ? rows : rows.filter((row) => row.status === filter)), [rows, filter])
  const editing = editingLine === null ? undefined : rows.find((row) => row.line === editingLine)
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories])

  const replaceRow = (next: ImportRow) => onChange(rows.map((row) => (row.line === next.line ? next : row)))

  const assign = (row: ImportRow, categoryId: Id) => {
    replaceRow(assignCategory(row, categoryId))
    setEditingLine(null)
    // ТЗ §61: после ручного выбора предложить правило — обычное локальное, без ИИ
    if (row.description.trim() !== '' && row.ruleId === undefined) setRulePrompt({ description: row.description, categoryId })
  }

  const assignBulk = (type: EntryType, categoryId: Id) => {
    onChange(rows.map((row) => (row.status === 'needsCategory' && row.type === type ? assignCategory(row, categoryId) : row)))
    setBulkType(null)
  }

  const needsByType = (type: EntryType) => rows.filter((row) => row.status === 'needsCategory' && row.type === type).length

  const ruleCreated = () => {
    setRulePrompt(null)
    // Правило уже в базе; живой запрос обновит rulesData позже, поэтому применяем к строкам сами
    void (async () => {
      const { categoryRulesRepository } = await import('../../features/rules/repository')
      const rules = compileRules(await categoryRulesRepository.listAll())
      onChange(applyRulesToRows(rows, rules, categories, accountId))
      toast.show('Правило создано и применено к строкам без категории')
    })()
  }

  return (
    <div className={styles.step}>
      <p className={styles.summary} aria-live="polite">
        <span>Готово: <strong>{summary.ready}</strong></span>
        <span>Дубли: <strong>{summary.duplicates}</strong></span>
        <span>Ошибки: <strong>{summary.errors}</strong></span>
        <span>Без категории: <strong>{summary.needsCategory}</strong></span>
      </p>

      {(needsByType('expense') > 0 || needsByType('income') > 0) && (
        <div className={styles.bulk}>
          {needsByType('expense') > 0 && (
            <Button variant="secondary" block onClick={() => setBulkType('expense')}>
              Категория для {needsByType('expense')} {pluralRu(needsByType('expense'), ['расхода', 'расходов', 'расходов'])} без категории
            </Button>
          )}
          {needsByType('income') > 0 && (
            <Button variant="secondary" block onClick={() => setBulkType('income')}>
              Категория для {needsByType('income')} {pluralRu(needsByType('income'), ['дохода', 'доходов', 'доходов'])} без категории
            </Button>
          )}
        </div>
      )}

      <ChipGroup chips={FILTER_OPTIONS} value={filter} onChange={setFilter} label="Показать строки" layout="scroll" />

      <ul className={styles.rows} aria-label="Строки файла">
        {visible.slice(0, PREVIEW_ROWS).map((row) => (
          <li key={row.line}>
            <button type="button" className={styles.row} data-status={row.status} onClick={() => setEditingLine(row.line)}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{row.description || '—'}</span>
                <span className={styles.rowMeta}>
                  {row.date ? formatDayShort(row.date, today) : `строка ${row.line}`}
                  {' · '}
                  {row.status === 'error' ? row.error : row.categoryId ? categoryById.get(row.categoryId)?.name ?? MISSING_CATEGORY.name : 'категория не выбрана'}
                </span>
              </span>
              <span className={styles.rowSide}>
                {row.amount !== undefined && row.type && (
                  <span className={styles.rowAmount} data-type={row.type}>
                    {Money.format(row.type === 'expense' ? -row.amount : row.amount, currency, { sign: 'always' })}
                  </span>
                )}
                <span className={styles.status} data-status={row.status}>
                  {row.status === 'duplicate' && row.include ? 'импорт всё равно' : IMPORT_STATUS_LABELS[row.status]}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {visible.length > PREVIEW_ROWS && (
        <p className={styles.hint}>Показаны первые {PREVIEW_ROWS} из {visible.length} строк. Остальные — через фильтры выше.</p>
      )}

      <div className={styles.actions}>
        <Button block disabled={summary.toImport === 0 || busy} onClick={onCommit}>
          Импортировать {summary.toImport} {pluralRu(summary.toImport, ['операцию', 'операции', 'операций'])}
        </Button>
        <Button variant="ghost" block onClick={onBack} disabled={busy}>
          Назад к колонкам
        </Button>
      </div>

      <Sheet open={editing !== undefined} onClose={() => setEditingLine(null)} title={editing ? `Строка ${editing.line}` : ''}>
        {editing && (
          <div className={styles.editor}>
            <p className={styles.text}>
              <strong>{editing.description || 'Без описания'}</strong>
              {editing.date && editing.amount !== undefined && editing.type && (
                <>
                  <br />
                  {formatDayShort(editing.date, today)} · {Money.format(editing.type === 'expense' ? -editing.amount : editing.amount, currency, { sign: 'always' })}
                </>
              )}
            </p>
            {editing.status === 'error' && <p className={styles.hint}>Строка не импортируется: {editing.error}. Исправьте файл или пропустите её.</p>}
            {editing.status === 'duplicate' && (
              <>
                <p className={styles.hint}>
                  {editing.duplicateOf === 'existing' ? 'Такая операция уже есть на этом счёте.' : 'Такая же строка есть выше в файле.'} По умолчанию она пропускается.
                </p>
                <label className={styles.toggle}>
                  <input type="checkbox" className={styles.checkbox} checked={editing.include} onChange={(event) => replaceRow(setInclude(editing, event.target.checked))} />
                  <span>Импортировать всё равно</span>
                </label>
              </>
            )}
            {editing.status !== 'error' && editing.type && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Категория</h2>
                <CategoryPicker
                  categories={categories.filter((category) => category.type === editing.type)}
                  value={editing.categoryId}
                  onChange={(categoryId: Id) => assign(editing, categoryId)}
                />
              </section>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={bulkType !== null} onClose={() => setBulkType(null)} title={bulkType === 'income' ? 'Категория для доходов' : 'Категория для расходов'}>
        {bulkType && (
          <div className={styles.editor}>
            <p className={styles.hint}>Она подставится всем {bulkType === 'income' ? 'доходам' : 'расходам'} без категории. Отдельные строки можно поправить потом.</p>
            <CategoryPicker categories={categories.filter((category) => category.type === bulkType)} value={null} onChange={(categoryId: Id) => assignBulk(bulkType, categoryId)} />
          </div>
        )}
      </Sheet>

      <Sheet open={rulePrompt !== null} onClose={() => setRulePrompt(null)} title="Запомнить правило?">
        {rulePrompt && (
          <div className={styles.editor}>
            <p className={styles.text}>
              Всегда относить операции с «{rulePrompt.description}» к «{categoryById.get(rulePrompt.categoryId)?.name ?? ''}»? Текст можно сократить до узнаваемой части.
            </p>
            <RuleForm
              rule={null}
              data={rulesData}
              defaults={{ pattern: rulePrompt.description, categoryId: rulePrompt.categoryId, name: rulePrompt.description.slice(0, 40) }}
              onDone={ruleCreated}
            />
            <Button variant="ghost" block onClick={() => setRulePrompt(null)}>
              Не запоминать
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  )
}
