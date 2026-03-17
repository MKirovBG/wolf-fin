import { NavLink, Outlet } from 'react-router-dom'
import { ToastProvider } from './Toast.tsx'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/agents', label: 'Agents' },
  { to: '/positions', label: 'Positions' },
  { to: '/keys', label: 'API Keys' },
  { to: '/reports', label: 'Reports' },
  { to: '/account', label: 'Account' },
]

export function Layout() {
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <aside className="w-48 bg-surface border-r border-border flex flex-col flex-shrink-0">
          <div className="px-5 py-4 border-b border-border">
            <span className="text-green font-bold tracking-[3px] text-base">WOLF-FIN</span>
          </div>
          <nav className="flex flex-col py-3 flex-1">
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `px-5 py-2.5 text-xs tracking-wide transition-colors ${
                    isActive
                      ? 'text-green bg-green-dim border-l-2 border-green'
                      : 'text-muted hover:text-white hover:bg-surface2'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-3 border-t border-border">
            <span className="text-[10px] text-muted">v1.0.0</span>
          </div>
        </aside>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  )
}
