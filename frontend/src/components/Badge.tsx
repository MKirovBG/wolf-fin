interface BadgeProps { label: string; variant: 'buy' | 'sell' | 'hold' | 'cancel' | 'paper' | 'live' | 'crypto' | 'forex' | 'mt5' }

const styles: Record<BadgeProps['variant'], string> = {
  buy:    'bg-green-dim border border-green/30 text-green',
  sell:   'bg-red-dim border border-red/30 text-red',
  hold:   'bg-yellow-dim border border-yellow/30 text-yellow',
  cancel: 'bg-purple-dim border border-purple/30 text-purple',
  paper:  'bg-green-dim border border-green/30 text-green',
  live:   'bg-red-dim border border-red/30 text-red',
  crypto: 'bg-blue-dim border border-blue/30 text-blue',
  forex:  'bg-yellow-dim border border-yellow/30 text-yellow',
  mt5:    'bg-purple-dim border border-purple/30 text-purple',
}

export function Badge({ label, variant }: BadgeProps) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide font-sans ${styles[variant]}`}>
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
