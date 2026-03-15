import type { ReactNode } from 'react'

interface CardProps { title: string; children: ReactNode; className?: string }

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`bg-surface border border-border rounded-md p-4 ${className}`}>
      <div className="text-[10px] uppercase tracking-[1.5px] text-muted border-b border-border pb-2 mb-4">
        {title}
      </div>
      {children}
    </div>
  )
}
