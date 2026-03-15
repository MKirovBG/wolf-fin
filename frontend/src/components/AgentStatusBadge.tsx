import type { AgentStatus } from '../types/index.ts'

interface Props { status: AgentStatus; showLabel?: boolean }

const cfg: Record<AgentStatus, { dot: string; label: string; pulse: boolean }> = {
  running: { dot: 'bg-green',  label: 'RUNNING', pulse: true  },
  paused:  { dot: 'bg-yellow', label: 'PAUSED',  pulse: false },
  idle:    { dot: 'bg-muted',  label: 'IDLE',    pulse: false },
}

export function AgentStatusBadge({ status, showLabel = true }: Props) {
  const { dot, label, pulse } = cfg[status]
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${dot} ${pulse ? 'animate-pulse' : ''}`} />
      {showLabel && <span className="text-[10px] tracking-widest text-muted">{label}</span>}
    </span>
  )
}
