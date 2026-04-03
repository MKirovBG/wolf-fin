import { useState, useRef, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  LineChart,
  History,
  Crosshair,
  Settings,
  Wallet,
  Bell,
  ChevronDown,
  Search,
  UserCircle,
  Menu,
  X,
  Brain,
  ShieldCheck,
  BarChart3,
  Download,
} from 'lucide-react'
import { ToastProvider } from './Toast.tsx'
import { useAccount, buildAccountLabel, entryToSelectedAccount } from '../contexts/AccountContext.tsx'
import type { AccountEntry } from '../types/index.ts'

const NAV_MAIN = [
  { to: '/',           label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/symbols',    label: 'Watchlist',  icon: LineChart       },
  { to: '/history',    label: 'History',    icon: History         },
  { to: '/strategies', label: 'Strategies', icon: Crosshair       },
]

const NAV_AGENT = [
  { to: '/agent/memory', label: 'Memory', icon: Brain       },
  { to: '/agent/rules',  label: 'Rules',  icon: ShieldCheck  },
]

const NAV_TOOLS = [
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/export',    label: 'Data Export', icon: Download },
  { to: '/config',    label: 'Settings', icon: Settings },
  { to: '/account',   label: 'Accounts', icon: Wallet   },
]

// ── Account selector (top bar) ────────────────────────────────────────────────

function TopAccountSelector() {
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
          selectedAccount
            ? 'border-border bg-surface2 text-text hover:border-brand/40'
            : 'border-yellow/40 bg-yellow/5 text-yellow hover:border-yellow/60 animate-pulse'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          selectedAccount ? 'bg-brand shadow-[0_0_5px_rgba(0,196,173,0.6)]' : 'bg-yellow'
        }`} />
        <span className="font-mono truncate max-w-[140px]">
          {currentLabel ?? 'Select account…'}
        </span>
        <ChevronDown size={12} className="text-muted flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-56 bg-surface2 border border-border rounded-xl shadow-dropdown z-50 overflow-hidden">
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
                  isSelected ? 'text-brand' : 'text-text'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  entry.connected ? 'bg-brand shadow-[0_0_4px_rgba(0,196,173,0.5)]' : 'bg-muted2'
                }`} />
                <span className="flex-1 truncate font-mono">{label}</span>
                {isSelected && <span className="text-brand text-[10px]">✓</span>}
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

// ── Sidebar nav link ───────────────────────────────────────────────────────────

function SidebarLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string
  label: string
  icon: React.ElementType
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-surface3 text-text'
            : 'text-muted hover:text-text hover:bg-surface2'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={16} className={isActive ? 'text-brand' : 'text-muted'} strokeWidth={1.75} />
          {label}
        </>
      )}
    </NavLink>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  const sidebar = (
    <aside
      className="w-[220px] bg-surface flex flex-col flex-shrink-0 h-full"
      style={{ borderRight: '1px solid #252D45' }}
    >
      {/* ── Logo ── */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #252D45' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #00C4AD 0%, #007A6E 100%)',
              boxShadow: '0 0 12px rgba(0,196,173,0.40)',
            }}
          >
            <span className="text-[10px] font-black text-[#0B0E18]">WF</span>
          </div>
          <span className="text-text font-bold text-sm tracking-[1.5px] uppercase">Wolf-Fin</span>
        </div>
        <button
          onClick={() => setMenuOpen(false)}
          className="md:hidden text-muted hover:text-text p-1"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5">
        <div className="px-5 pb-2 pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted2">Navigation</span>
        </div>
        {NAV_MAIN.map(l => (
          <SidebarLink key={l.to} to={l.to} label={l.label} icon={l.icon} end={l.to === '/'} />
        ))}

        <div className="px-5 pb-2 pt-4">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted2">Agent</span>
        </div>
        {NAV_AGENT.map(l => (
          <SidebarLink key={l.to} to={l.to} label={l.label} icon={l.icon} />
        ))}

        <div className="px-5 pb-2 pt-4">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted2">Tools</span>
        </div>
        {NAV_TOOLS.map(l => (
          <SidebarLink key={l.to} to={l.to} label={l.label} icon={l.icon} />
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="pb-4 pt-2 space-y-0.5" style={{ borderTop: '1px solid #252D45' }}>
        <div className="mx-2 px-3 py-2 flex items-center gap-2 text-xs text-muted2">
          <span className="w-1.5 h-1.5 rounded-full bg-muted2" />
          <span className="font-mono">v1.0.0</span>
        </div>
      </div>
    </aside>
  )

  return (
    <ToastProvider>
      <div className="flex h-screen bg-bg overflow-hidden">

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

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* ── Top bar ── */}
          <header
            className="flex-shrink-0 flex items-center justify-between px-5 bg-surface h-14"
            style={{ borderBottom: '1px solid #252D45' }}
          >
            {/* Left: mobile hamburger + search */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMenuOpen(true)}
                className="md:hidden text-muted hover:text-text p-1"
                aria-label="Open menu"
              >
                <Menu size={18} />
              </button>
              <div className="hidden md:flex items-center gap-2 bg-surface2 border border-border rounded-lg px-3 py-1.5 w-52">
                <Search size={13} className="text-muted flex-shrink-0" />
                <span className="text-xs text-muted2">Search…</span>
              </div>
            </div>

            {/* Right: notifications + account + user */}
            <div className="flex items-center gap-2">
              {/* Bell */}
              <button className="relative p-2 rounded-lg hover:bg-surface2 text-muted hover:text-text transition-colors">
                <Bell size={16} />
              </button>

              {/* Account selector */}
              <TopAccountSelector />

              {/* User pill */}
              <div className="flex items-center gap-2 pl-2 ml-1 border-l border-border">
                <UserCircle size={26} className="text-muted" strokeWidth={1.5} />
                <div className="hidden lg:block leading-none">
                  <div className="text-xs font-medium text-text">Wolf-Fin</div>
                  <div className="text-[10px] text-muted2 mt-0.5">Trading Agent</div>
                </div>
                <ChevronDown size={12} className="text-muted hidden lg:block" />
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>

        </div>
      </div>
    </ToastProvider>
  )
}
