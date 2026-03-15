interface StatusDotProps { status: 'idle' | 'running' | 'paused' }

export function StatusDot({ status }: StatusDotProps) {
  const cls =
    status === 'running'
      ? 'bg-green shadow-[0_0_6px_#00e676]'
      : status === 'paused'
        ? 'bg-yellow'
        : 'bg-muted2'
  return <span className={`inline-block w-2 h-2 rounded-full mr-2 ${cls}`} />
}
