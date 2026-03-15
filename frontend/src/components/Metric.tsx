import type { ReactNode } from 'react'

interface MetricProps { label: string; value: ReactNode }

export function Metric({ label, value }: MetricProps) {
  return (
    <div className="flex justify-between items-center mb-3 last:mb-0">
      <span className="text-muted text-xs">{label}</span>
      <span className="font-bold text-sm">{value}</span>
    </div>
  )
}
