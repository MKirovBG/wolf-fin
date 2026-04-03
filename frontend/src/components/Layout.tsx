import { useState, useRef, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ToastProvider } from './Toast.tsx'
import { useAccount, buildAccountLabel, entryToSelectedAccount } from '../contexts/AccountContext.tsx'
import type { AccountEntry } from '../types/index.ts'

const links = [
  { to: '/',           label: 'Dashboard'  },
  { to: '/symbols',    label: 'Watchlist'  },
  { to: '/history',    label: 'History'    },
  { to: '/strategies', label: 'Strategies' },
  { to: '/config',     label: 'Settings'   },
]

// ── Account selector ──────────────────────────────────────────────────────────

function AccountSelector() {
  const { selectedAccount, accounts, setSelectedAccount } = useAccount()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentLabel = selectedAccount?.label
    ?? (selectedAccount ? `${selectedAccount.market} · ${selectedAccount.accountId}` : null)

  const select = async (entry: AccountEntry) => {
    await setSelectedAccount(entryToSelectedAccount(entry))
    setOpen(false)
  }

  const clear = async () => {
    await setSelectedAccount(null)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <div className="text-[9px] font-semibold uppercase tracking-widest text-muted2 mb-1.5 px-1">
        Active Account
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        title={currentLabel ?? 'No account selected'}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
          selectedAccount
            ? 'border-border bg-surface2 text-text hover:border-muted2'
            : 'border-yellow/50 bg-yellow-dim text-yellow hover:border-yellow animate-pulse'
        }`}
      >
        {selectedAccount ? (
          <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow flex-shrink-0" />
        )}
        <span className="flex-1 text-left truncate font-mono text-[11px]">
          {currentLabel ?? 'Select account…'}
        </span>
        <span className="text-muted text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {accounts.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted text-center">
              No accounts found.<br />
              <span className="text-muted2">Configure them in Accounts.</span>
            </div>
          )}
          {accounts.map(entry => {
            const label = buildAccountLabel(entry)
            const isSelected = selectedAccount
              ? (entry.exchange === 'mt5'
                  ? selectedAccount.market === 'mt5' && selectedAccount.accountId === String((entry as { summary?: { login?: number } }).summary?.login ?? entry.id.replace('mt5-', ''))
                  : selectedAccount.market === 'crypto')
              : false
            return (
              <button
                key={entry.id}
                onClick={() => select(entry)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left hover:bg-surface2 transition-colors border-b border-border last:border-0 ${
                  isSelected ? 'text-green' : 'text-text'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.connected ? 'bg-green' : 'bg-muted2'}`} />
                <span className="flex-1 truncate font-mono">{label}</span>
                {isSelected && <span className="text-green text-[10px] flex-shrink-0">✓</span>}
              </button>
            )
          })}
          {selectedAccount && (
            <button
              onClick={clear}
              className="w-full px-3 py-2 text-[11px] text-muted2 hover:text-red hover:bg-surface2 transition-colors border-t border-border text-left"
            >
              ✕ Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-5 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'text-green bg-green-dim border-l-2 border-green'
        : 'text-muted hover:text-text hover:bg-surface2'
    }`

  const sidebar = (
    <aside className="w-52 bg-surface border-r border-border flex flex-col flex-shrink-0 h-full">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <span className="text-green font-bold text-base tracking-[2px]">WOLF-FIN</span>
        {/* Close button — mobile only */}
        <button
          onClick={() => setMenuOpen(false)}
          className="md:hidden text-muted hover:text-text p-1"
          aria-label="Close menu"
        >✕</button>
      </div>
      <nav className="flex flex-col py-2 flex-1 overflow-y-auto">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={navLinkClass}>
            {l.label}
          </NavLink>
        ))}
        <NavLink to="/account" className={navLinkClass}>Accounts</NavLink>
      </nav>
      <div className="border-t border-border pt-3">
        <AccountSelector />
        <div className="px-5 py-2">
          <span className="text-xs text-muted2">v1.0.0</span>
        </div>
      </div>
    </aside>
  )

  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">

        {/* Desktop sidebar */}
        <div className="hidden md:flex md:flex-shrink-0">
          {sidebar}
        </div>

        {/* Mobile sidebar overlay */}
        {menuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
            <div className="relative z-10 flex-shrink-0">
              {sidebar}
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-surface flex-shrink-0">
            <button
              onClick={() => setMenuOpen(true)}
              className="text-muted hover:text-text p-1"
              aria-label="Open menu"
            >
              <div className="flex flex-col gap-1">
                <span className="block w-5 h-px bg-current" />
                <span className="block w-5 h-px bg-current" />
                <span className="block w-5 h-px bg-current" />
              </div>
            </button>
            <span className="text-green font-bold text-sm tracking-[2px]">WOLF-FIN</span>
            <div className="w-7" /> {/* spacer */}
          </div>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>

      </div>
    </ToastProvider>
  )
}
