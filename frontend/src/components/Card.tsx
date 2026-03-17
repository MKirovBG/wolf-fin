import type { ReactNode } from 'react'

interface CardProps { title: string; children: ReactNode; className?: string }

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`bg-surface border border-border rounded-lg p-4 ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted border-b border-border pb-2.5 mb-4">
        {title}
      </div>
      {children}
    </div>
  )
}
