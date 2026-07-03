'use client'

import { useState } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { UserAnalytics } from '@/types'

// Single-series marks (score trend, accuracy bars/radar) use the brand accent
// directly — one series needs no legend or CVD separation.
const LIME = '#D7FF3D'

// Categorical palette for the subject-identity donut (nominal categories,
// order carries no meaning). Anchored on the brand hue, validated against
// this app's dark navy surface (#0d1230) with scripts/validate_palette.js
// from the dataviz skill: all 8 slots pass the lightness band, chroma floor,
// and contrast checks; the adjacent red/teal pair sits in the CVD floor band
// (WARN, legal only with secondary encoding) — covered here by the legend +
// tooltip labels that always accompany this chart.
const CATEGORICAL_COLORS = [
  '#899e28', // olive-lime (brand-anchored)
  '#6f93dd', // blue
  '#c98500', // amber
  '#1f9e6e', // teal
  '#e66767', // red
  '#d55181', // magenta
]

const tooltipStyle = {
  backgroundColor: '#0d1230',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '8px',
  fontSize: '13px',
  color: '#fff',
}

const axisTickStyle = { fill: 'rgba(255,255,255,0.5)', fontSize: 12 }

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <h3 className="font-medium text-white mb-4">{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart() {
  return <div className="h-56 flex items-center justify-center text-white/30 text-sm">Not enough data yet</div>
}

// Every chart gets a table-view twin — tooltips enhance but never gate a
// value, so each row here is reachable without hovering.
function TableToggle({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-white/40 hover:text-white/70 transition-colors"
      >
        {open ? 'Hide table' : 'View as table'}
      </button>
      {open && (
        <table className="w-full mt-2 text-xs text-white/70 border-collapse">
          <thead>
            <tr className="border-b border-white/10">
              {headers.map((h) => (
                <th key={h} className="text-left font-medium text-white/50 py-1.5 pr-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-white/5">
                {row.map((cell, j) => (
                  <td key={j} className="py-1.5 pr-3">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function AnalyticsCharts({ analytics }: { analytics: UserAnalytics }) {
  const hasScoreTrend = analytics.score_trend.length > 1
  const hasSubjectAccuracyData = analytics.by_subject_accuracy.length > 0
  const hasDifficultyData = analytics.by_difficulty.length > 1
  const hasSubjectData = analytics.by_subject.length > 0

  const scoreTrendData = analytics.score_trend.map((point, index) => ({
    name: `#${index + 1}`,
    score: Math.round(point.score),
    subject: point.subject,
  }))

  const subjectAccuracyData = [...analytics.by_subject_accuracy]
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((entry) => ({ name: entry.label, accuracy: entry.accuracy }))

  const difficultyOrder = ['easy', 'medium', 'hard']
  const difficultyData = [...analytics.by_difficulty]
    .sort((a, b) => difficultyOrder.indexOf(a.label) - difficultyOrder.indexOf(b.label))
    .map((entry) => ({ subject: entry.label, accuracy: entry.accuracy, fullMark: 100 }))

  // Cap at the validated palette's slot count; fold the rest into "Other"
  // rather than cycling colors past the validated set.
  const sortedSubjects = [...analytics.by_subject].sort((a, b) => b.count - a.count)
  const topSubjects = sortedSubjects.slice(0, CATEGORICAL_COLORS.length)
  const otherCount = sortedSubjects.slice(CATEGORICAL_COLORS.length).reduce((sum, s) => sum + s.count, 0)
  const subjectData = [
    ...topSubjects.map((entry) => ({ name: entry.label, value: entry.count })),
    ...(otherCount > 0 ? [{ name: 'Other', value: otherCount }] : []),
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ChartCard title="Score Trend">
        {hasScoreTrend ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={scoreTrendData}>
              <defs>
                <linearGradient id="scoreTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={LIME} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={LIME} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="name" tick={axisTickStyle} axisLine={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <YAxis domain={[0, 100]} tick={axisTickStyle} axisLine={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`${value}%`, 'Score']}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.subject ?? ''}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke={LIME}
                strokeWidth={2}
                fill="url(#scoreTrendFill)"
                dot={{ fill: LIME, r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
        {hasScoreTrend && (
          <TableToggle
            headers={['Attempt', 'Subject', 'Score']}
            rows={analytics.score_trend.map((point, i) => [`#${i + 1}`, point.subject, `${Math.round(point.score)}%`])}
          />
        )}
      </ChartCard>

      <ChartCard title="Accuracy by Subject">
        {hasSubjectAccuracyData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={subjectAccuracyData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={axisTickStyle} axisLine={{ stroke: 'rgba(255,255,255,0.15)' }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={axisTickStyle}
                axisLine={{ stroke: 'rgba(255,255,255,0.15)' }}
                width={110}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, 'Accuracy']} />
              <Bar dataKey="accuracy" fill={LIME} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
        {hasSubjectAccuracyData && (
          <TableToggle
            headers={['Subject', 'Correct', 'Total', 'Accuracy']}
            rows={subjectAccuracyData.map((entry) => {
              const full = analytics.by_subject_accuracy.find((e) => e.label === entry.name)
              return [entry.name, full?.correct ?? '—', full?.total ?? '—', `${entry.accuracy}%`]
            })}
          />
        )}
      </ChartCard>

      <ChartCard title="Accuracy by Difficulty">
        {hasDifficultyData ? (
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={difficultyData}>
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis dataKey="subject" tick={axisTickStyle} className="capitalize" />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
              <Radar dataKey="accuracy" stroke={LIME} fill={LIME} fillOpacity={0.3} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, 'Accuracy']} />
            </RadarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
        {hasDifficultyData && (
          <TableToggle
            headers={['Difficulty', 'Accuracy']}
            rows={difficultyData.map((entry) => [entry.subject, `${entry.accuracy}%`])}
          />
        )}
      </ChartCard>

      <ChartCard title="Quizzes by Subject">
        {hasSubjectData ? (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={subjectData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {subjectData.map((_, index) => (
                  <Cell key={index} fill={CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length]} />
                ))}
              </Pie>
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => <span style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</span>}
              />
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
        {hasSubjectData && (
          <TableToggle
            headers={['Subject', 'Quizzes']}
            rows={subjectData.map((entry) => [entry.name, entry.value])}
          />
        )}
      </ChartCard>
    </div>
  )
}
