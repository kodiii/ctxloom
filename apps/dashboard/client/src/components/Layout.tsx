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
    <div className="flex h-screen bg-[#18181f]">
      <aside className="w-52 shrink-0 border-r border-white/8 bg-[#131220] flex flex-col">
        <div className="px-5 py-4 border-b border-white/8">
          <span className="text-sm font-semibold text-[#a78bfa]">ctxloom</span>
          <span className="ml-1 text-xs text-white/30">dashboard</span>
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
                    ? 'bg-[#603dc6]/15 text-[#a78bfa] font-medium'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-8 bg-[#18181f]">
        <Outlet />
      </main>
    </div>
  );
}
