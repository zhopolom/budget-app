import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DailyExpensePoint } from '../../features/analytics/service'
import type { CurrencyCode } from '../../types/entities'
import { formatDayLabel } from '../../utils/dates'
import { Money } from '../../utils/money'
import styles from './DailyExpenseChart.module.css'

interface DailyExpenseChartProps {
  points: DailyExpensePoint[]
  currency: CurrencyCode
  today: string
}

/**
 * Расходы по дням месяца. Recharts грузится отдельным чанком (lazy в
 * AnalyticsPage) — ради одного графика тянуть его в основной бандл не стоит.
 */
export default function DailyExpenseChart({ points, currency, today }: DailyExpenseChartProps) {
  // Подписи только у каждого пятого дня: иначе на 390px ось превращается в кашу
  const ticks = points.filter((point) => point.day === 1 || point.day % 5 === 0).map((point) => point.day)

  return (
    <div className={styles.chart}>
      <ResponsiveContainer width="100%" height={180}>
        {/* Нулевые отступы слева: любой минус срезает подписи оси Y */}
        <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={1}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="day"
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-2)', fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={46}
            tickCount={4}
            tick={{ fill: 'var(--ink-2)', fontSize: 11 }}
            tickFormatter={(value: number) => (value === 0 ? '' : Money.formatCompact(value))}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
            labelFormatter={(_label, payload) => {
              const point = payload?.[0]?.payload as DailyExpensePoint | undefined
              return point ? formatDayLabel(point.date, today) : ''
            }}
            formatter={(value) => [Money.format(Number(value ?? 0), currency), 'Расходы']}
          />
          <Bar dataKey="expense" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
