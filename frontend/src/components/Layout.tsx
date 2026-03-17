import { NavLink, Outlet } from 'react-router-dom'
import { ToastProvider } from './Toast.tsx'

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/agents', label: 'Agents' },
  { to: '/positions', label: 'Positions' },
  { to: '/keys', label: 'Integrations' },
  { to: '/reports', label: 'Reports' },
  { to: '/account', label: 'Account' },
]

export function Layout() {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">
        <aside className="w-52 bg-surface border-r border-border flex flex-col flex-shrink-0">
          <div className="px-5 py-4 border-b border-border">
            <span className="text-green font-bold text-base tracking-[2px]">WOLF-FIN</span>
          </div>
          <nav className="flex flex-col py-2 flex-1">
            {links.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `px-5 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-green bg-green-dim border-l-2 border-green'
                      : 'text-muted hover:text-text hover:bg-surface2'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-3 border-t border-border">
            <span className="text-xs text-muted2">v1.0.0</span>
          </div>
        </aside>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  )
}
