interface RiskBarProps { remaining: number; total: number }

export function RiskBar({ remaining, total }: RiskBarProps) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0
  const color = pct > 50 ? 'bg-green' : pct > 20 ? 'bg-yellow' : 'bg-red'
  return (
    <div className="bg-muted2 rounded-sm h-1 mt-3">
      <div className={`${color} h-1 rounded-sm transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  )
}
