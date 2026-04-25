import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/graph', label: 'Graph', icon: '⬡' },
  { to: '/risk', label: 'Risk', icon: '⚠' },
  { to: '/trends', label: 'Trends', icon: '⤴' },
  { to: '/communities', label: 'Communities', icon: '⬡⬡' },
  { to: '/ownership', label: 'Ownership', icon: '◎' },
  { to: '/guide', label: 'Guide', icon: '◉' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-[#18181f]">
      <aside className="w-52 shrink-0 bg-[#131220] flex flex-col" style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-4 py-4 flex items-center gap-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <img src="/logo.svg" alt="ctxloom" className="w-6 h-6 shrink-0" />
          <div>
            <span className="text-sm font-semibold"><span className="text-white">ctx</span><span className="text-[#a78bfa]">loom</span></span>
            <span className="ml-1 text-xs text-white/30">dashboard</span>
          </div>
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-[#603dc6]/15 text-[#a78bfa] font-medium'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`
              }
            >
              <span className="text-xs select-none shrink-0">{icon}</span>
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
