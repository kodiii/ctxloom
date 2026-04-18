import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/graph', label: 'Graph' },
  { to: '/risk', label: 'Risk' },
  { to: '/communities', label: 'Communities' },
  { to: '/ownership', label: 'Ownership' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <span className="text-sm font-semibold text-gray-900">ctxloom</span>
          <span className="ml-1 text-xs text-gray-400">dashboard</span>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
