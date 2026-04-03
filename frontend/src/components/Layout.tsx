import { useState, useRef, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ToastProvider } from './Toast.tsx'
import { useAccount, buildAccountLabel, entryToSelectedAccount } from '../contexts/AccountContext.tsx'
import type { AccountEntry } from '../types/index.ts'

const NAV_MAIN = [
  { to: '/',           label: 'Dashboard'   },
  { to: '/symbols',    label: 'Watchlist'   },
  { to: '/history',    label: 'History'     },
  { to: '/strategies', label: 'Strategies'  },
]

const NAV_TOOLS = [
  { to: '/config',     label: 'Settings'    },
  { to: '/account',    label: 'Accounts'    },
]

// ── Account selector ──────────────────────────────────────────────────────────

function AccountSelector() {
  const { selectedAccount, accounts, setSelectedAccount } = useAccount()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all ${
          selectedAccount
            ? 'border-border bg-surface2 text-text hover:border-teal/40'
            : 'border-yellow/40 bg-yellow/5 text-yellow hover:border-yellow/60 animate-pulse'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          selectedAccount ? 'bg-teal shadow-[0_0_6px_rgba(0,229,204,0.6)]' : 'bg-yellow'
        }`} />
        <span className="flex-1 text-left truncate font-mono text-[11px]">
          {currentLabel ?? 'Select account…'}
        </span>
        <span className="text-muted text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-surface2 border border-border rounded-lg shadow-dropdown z-50 overflow-hidden">
          {accounts.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted text-center">
              No accounts found.<br />
              <span className="text-muted2">Configure in Accounts.</span>
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
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left hover:bg-surface3 transition-colors border-b border-border/60 last:border-0 ${
                  isSelected ? 'text-teal' : 'text-text'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  entry.connected
                    ? 'bg-teal shadow-[0_0_5px_rgba(0,229,204,0.5)]'
                    : 'bg-muted2'
                }`} />
                <span className="flex-1 truncate font-mono">{label}</span>
                {isSelected && <span className="text-teal text-[10px] flex-shrink-0">✓</span>}
              </button>
            )
          })}
          {selectedAccount && (
            <button
              onClick={clear}
              className="w-full px-3 py-2 text-[11px] text-muted2 hover:text-red hover:bg-surface3 transition-colors border-t border-border text-left"
            >
              ✕ Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Nav link ──────────────────────────────────────────────────────────────────

function SidebarLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-all ${
          isActive
            ? 'text-teal bg-teal/8 border-l-2 border-teal'
            : 'text-muted border-l-2 border-transparent hover:text-text hover:bg-surface2'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const sidebar = (
    <aside className="w-56 bg-surface flex flex-col flex-shrink-0 h-full" style={{
      borderRight: '1px solid #1E3352',
      boxShadow: '1px 0 0 rgba(0,229,204,0.04)',
    }}>

      {/* ── Logo ── */}
      <div className="px-5 py-4 flex items-center justify-between" style={{
        borderBottom: '1px solid #1E3352',
      }}>
        <div className="flex items-center gap-2.5">
          {/* Teal accent square */}
          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" style={{
            background: 'linear-gradient(135deg, #00E5CC 0%, #009B8A 100%)',
            boxShadow: '0 0 12px rgba(0,229,204,0.35)',
          }}>
            <span className="text-[10px] font-black text-[#08111E]">WF</span>
          </div>
          <span className="text-text font-bold text-sm tracking-[1.5px] uppercase">Wolf-Fin</span>
        </div>
        <button
          onClick={() => setMenuOpen(false)}
          className="md:hidden text-muted hover:text-text p-1"
          aria-label="Close menu"
        >✕</button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3">
        <div className="px-5 pb-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted2">Main</span>
        </div>
        {NAV_MAIN.map(l => (
          <SidebarLink key={l.to} to={l.to} label={l.label} end={l.to === '/'} />
        ))}

        <div className="px-5 pt-4 pb-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted2">Tools</span>
        </div>
        {NAV_TOOLS.map(l => (
          <SidebarLink key={l.to} to={l.to} label={l.label} />
        ))}
      </nav>

      {/* ── Account footer ── */}
      <div style={{ borderTop: '1px solid #1E3352' }} className="pt-3">
        <AccountSelector />
        <div className="px-5 pb-3">
          <span className="text-[10px] text-muted2">v1.0.0</span>
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
            <div className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} />
            <div className="relative z-10 flex-shrink-0">
              {sidebar}
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <div className="md:hidden flex items-center justify-between px-4 py-3 bg-surface flex-shrink-0" style={{ borderBottom: '1px solid #1E3352' }}>
            <button
              onClick={() => setMenuOpen(true)}
              className="text-muted hover:text-text p-1"
              aria-label="Open menu"
            >
              <div className="flex flex-col gap-1.5">
                <span className="block w-5 h-px bg-current" />
                <span className="block w-5 h-px bg-current" />
                <span className="block w-5 h-px bg-current" />
              </div>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded flex items-center justify-center" style={{
                background: 'linear-gradient(135deg, #00E5CC 0%, #009B8A 100%)',
              }}>
                <span className="text-[8px] font-black text-[#08111E]">WF</span>
              </div>
              <span className="text-text font-bold text-sm tracking-[1.5px] uppercase">Wolf-Fin</span>
            </div>
            <div className="w-7" />
          </div>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>

      </div>
    </ToastProvider>
  )
}
