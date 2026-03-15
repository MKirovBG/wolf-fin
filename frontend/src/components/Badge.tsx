interface BadgeProps { label: string; variant: 'buy' | 'sell' | 'hold' | 'cancel' | 'paper' | 'live' | 'crypto' | 'forex' }

const styles: Record<BadgeProps['variant'], string> = {
  buy: 'bg-green-dim border border-green-border text-green',
  sell: 'bg-red-dim border border-red-border text-red',
  hold: 'bg-yellow-dim border border-yellow-border text-yellow',
  cancel: 'bg-purple-900/20 border border-purple-500/30 text-purple-400',
  paper: 'bg-green-dim border border-green-border text-green',
  live: 'bg-red-dim border border-red-border text-red',
  crypto: 'bg-blue-900/20 border border-blue-500/30 text-blue-400',
  forex: 'bg-yellow-dim border border-yellow-border text-yellow',
}

export function Badge({ label, variant }: BadgeProps) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide ${styles[variant]}`}>
      {label}
    </span>
  )
}

export function decisionVariant(decision: string): BadgeProps['variant'] {
  const u = decision.toUpperCase()
  if (u.startsWith('BUY')) return 'buy'
  if (u.startsWith('SELL')) return 'sell'
  if (u.startsWith('CANCEL')) return 'cancel'
  return 'hold'
}
