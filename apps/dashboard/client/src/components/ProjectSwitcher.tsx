/**
 * ProjectSwitcher — dropdown that lets the user switch which project's
 * data the dashboard is showing.
 *
 * Sources:
 *   - The default project (whichever root the dashboard was launched
 *     against — always present).
 *   - Any repos registered via `ctxloom register <path>` that the user
 *     has run on this machine.
 *
 * Switching is server-driven: POST /api/projects/active mutates the
 * server's in-memory ctx, so all subsequent /api/* responses reflect
 * the new project. We then trigger a full client-side reload so every
 * page re-fetches its data (cheaper and more reliable than threading
 * an invalidation event through every existing page hook).
 *
 * The "Hidden" name leak: dropdown shows project.name (basename),
 * never project.root, so a screenshot of the sidebar doesn't reveal
 * the user's filesystem layout.
 */
import { useEffect, useState } from 'react';
import type { DashboardProject } from '../lib/api';
import { api } from '../lib/api';

const STORAGE_KEY = 'ctxloom.dashboard.activeSlug';

export function ProjectSwitcher() {
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [active, setActive] = useState<DashboardProject | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load list on mount + reconcile localStorage selection.
  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);
        const activeFromList = list.find((p) => p.isActive) ?? list[0];
        setActive(activeFromList);
        // If localStorage says we should be on a different project than
        // the server's current active, ask the server to switch — keeps
        // selection sticky across browser refreshes / dashboard restarts.
        const stored = localStorage.getItem(STORAGE_KEY);
        if (
          stored &&
          stored !== activeFromList.slug &&
          list.some((p) => p.slug === stored)
        ) {
          void doSwitch(stored);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.('[data-project-switcher]')) setOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  async function doSwitch(slug: string) {
    setSwitching(slug);
    setError(null);
    try {
      const { active: newActive } = await api.switchProject(slug);
      localStorage.setItem(STORAGE_KEY, newActive.slug);
      // Reload to re-fetch every page's data against the new project.
      // Marker that survives the reload so we can show a one-time toast
      // if we wanted; not currently used.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSwitching(null);
    }
  }

  if (!active) {
    return (
      <div className="px-3 py-2 text-xs text-white/30">
        {error ? `Projects unavailable: ${error}` : 'Loading projects…'}
      </div>
    );
  }

  // Single project — no dropdown, just show the name. Avoids a useless
  // chevron when there's nothing to switch to.
  if (projects.length <= 1) {
    return (
      <div
        className="px-3 py-2 text-xs text-white/40 truncate"
        title={`${active.name}\n${active.root}`}
      >
        <span className="text-white/30">project: </span>
        <span className="text-white/80">{active.name}</span>
      </div>
    );
  }

  return (
    <div className="relative px-2 py-2" data-project-switcher>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching !== null}
        className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs text-white/80 hover:bg-white/5 transition-colors disabled:opacity-50"
        title={active.root}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-white/40 shrink-0">◆</span>
          <span className="truncate">{active.name}</span>
        </span>
        <span className="text-white/30 text-[10px] shrink-0">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div
          className="absolute left-2 right-2 mt-1 z-20 rounded-md bg-[#1f1e2c] py-1 shadow-lg"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {projects.map((p) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => {
                setOpen(false);
                if (p.slug !== active.slug) void doSwitch(p.slug);
              }}
              disabled={switching !== null}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                p.slug === active.slug
                  ? 'text-[#a78bfa] bg-[#603dc6]/10'
                  : 'text-white/70 hover:bg-white/5'
              } disabled:opacity-50`}
              title={p.root}
            >
              <span className="shrink-0 w-3 text-center">
                {p.slug === active.slug ? '●' : ' '}
              </span>
              <span className="truncate flex-1">{p.name}</span>
              {!p.hasSnapshot && (
                <span
                  className="text-[10px] text-white/30 shrink-0"
                  title="Never indexed — first switch will be slow"
                >
                  cold
                </span>
              )}
              {p.isDefault && (
                <span
                  className="text-[10px] text-white/30 shrink-0"
                  title="Project the dashboard was launched against"
                >
                  default
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {switching && (
        <div className="px-2.5 py-1 text-[10px] text-white/40">
          switching… (cold start may take a moment)
        </div>
      )}
      {error && (
        <div className="px-2.5 py-1 text-[10px] text-red-400/80" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
