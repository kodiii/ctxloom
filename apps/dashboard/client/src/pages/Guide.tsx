const SECTIONS = [
  {
    id: 'overview',
    title: 'Overview',
    icon: '◈',
    summary: 'Your codebase at a glance — health snapshot and architectural hotspots.',
    items: [
      {
        term: 'Files',
        def: 'Total source files indexed. Click to open the Dependency Graph.',
      },
      {
        term: 'Edges',
        def: 'Total import/dependency relationships between files. A high edge count relative to file count means a densely coupled codebase.',
      },
      {
        term: 'Communities',
        def: 'Logical modules detected automatically by grouping files that import each other heavily (Louvain algorithm). Think of them as architectural "neighbourhoods".',
      },
      {
        term: 'Git history',
        def: '"enabled" means git overlay data is loaded — Risk, Churn, and Ownership metrics will show real values. "disabled" means only static graph metrics are available. Run ctxloom index --with-git to enable.',
      },
      {
        term: 'Risk breakdown donut',
        def: 'Distribution of files across four risk tiers. A healthy codebase has most files in "low" and very few in "critical". Each slice is sized by file count.',
      },
      {
        term: 'Risk tiers',
        def: 'critical (score > 0.8) — urgent attention needed. high (> 0.6) — should be addressed soon. medium (> 0.3) — monitor. low (≤ 0.3) — acceptable.',
      },
      {
        term: 'Top architectural hubs',
        def: 'Files most imported by others (high in-degree ↑) or that import the most (high out-degree ↓). Hubs are load-bearing — a bug here ripples everywhere.',
      },
    ],
  },
  {
    id: 'graph',
    title: 'Dependency Graph',
    icon: '⬡',
    summary: 'Interactive force-directed map of every import relationship in your codebase.',
    items: [
      {
        term: 'Nodes (dots)',
        def: 'Each node is a file. Size reflects total degree (imports + importers) — bigger means more connected.',
      },
      {
        term: 'Node colour',
        def: 'Colour encodes the Louvain community. Files in the same community share many imports with each other. The community legend (bottom-left) maps colours to community IDs.',
      },
      {
        term: 'Red ring around a node',
        def: 'Risk alert. A thin red ring means riskScore > 0.6 (high). A thick red ring means riskScore > 0.8 (critical). These files need attention.',
      },
      {
        term: 'Edges (lines)',
        def: 'A line from A to B means A imports B. The direction shows dependency flow.',
      },
      {
        term: 'Labels',
        def: 'The top-15 most-connected files always show their filename. Hover any node to see full details.',
      },
      {
        term: 'Hover tooltip',
        def: 'Shows the full file path, in-degree (how many files import this), out-degree (how many files this imports), and risk score.',
      },
      {
        term: 'Click to highlight',
        def: 'Clicking a node dims everything except its direct neighbours. This reveals the file\'s immediate dependency context. Click again to reset.',
      },
      {
        term: 'Search box',
        def: 'Type a filename fragment to pan the viewport to the first matching node.',
      },
      {
        term: 'Zoom / pan',
        def: 'Scroll to zoom. Drag the background to pan. Drag individual nodes to reposition them.',
      },
      {
        term: 'Isolated nodes (far from centre)',
        def: 'Files with few or no dependencies — utilities, config files, or dead code candidates.',
      },
    ],
  },
  {
    id: 'risk',
    title: 'Risk',
    icon: '⚠',
    summary: 'Composite risk score per file, combining git churn, ownership concentration, and coupling.',
    items: [
      {
        term: 'Risk score',
        def: 'Weighted composite: (churn × 0.4) + (bus factor × 0.3) + (coupling × 0.3), normalised 0–1. Higher is riskier. Click the column header to sort.',
      },
      {
        term: 'Risk label (badge)',
        def: 'critical / high / medium / low — derived from the risk score thresholds above. Critical files deserve immediate review.',
      },
      {
        term: 'Churn lines',
        def: 'Total lines added + removed across all commits in the git window (default 365 days). High churn means the file changes frequently — volatility that correlates with bugs.',
      },
      {
        term: 'Bug density',
        def: 'Ratio of commits with bug-fix keywords (fix, bug, hotfix, patch) to total commits touching this file. A value of 0.30 means 30% of its commits were bug fixes — a strong signal of instability.',
      },
      {
        term: 'Bus factor',
        def: 'Minimum number of contributors whose loss would leave > 50% of this file\'s git history without a knowledgeable owner. Bus factor 1 = single point of failure.',
      },
      {
        term: 'Coupling',
        def: 'Number of other files that import this file (fan-out of its importers). High coupling = many blast radius victims when this file changes.',
      },
      {
        term: 'Owner',
        def: 'The git author responsible for the most lines of the file\'s history (by commit count share).',
      },
      {
        term: 'avg score',
        def: 'Mean risk score across all files shown. Use it as a baseline — individual files above this average warrant closer inspection.',
      },
    ],
  },
  {
    id: 'communities',
    title: 'Communities',
    icon: '⬡⬡',
    summary: 'Auto-detected architectural modules — files that belong together by import density.',
    items: [
      {
        term: 'What is a community?',
        def: 'A group of files that import each other more than they import files outside the group. Detected via the Louvain modularity algorithm on the dependency graph.',
      },
      {
        term: 'Community name',
        def: 'Named after the highest-degree file in the group (the hub). It\'s a label, not a hard boundary.',
      },
      {
        term: 'Size',
        def: 'Number of files in the community. Very large communities (50+ files) may indicate an overgrown module that should be split. Very small ones (1–2 files) may be isolated utilities.',
      },
      {
        term: 'Expanding a community',
        def: 'Click the row to expand and see all member files. This helps you verify whether the auto-grouping makes architectural sense.',
      },
      {
        term: 'What to look for',
        def: 'Ideally, communities map to feature domains (auth, payments, graph). If unrelated files appear in the same community, they may be over-coupled. If a feature is split across many communities, its modules may be too tangled.',
      },
      {
        term: '87 clusters',
        def: 'A high community count vs file count ratio is normal — many files are singletons or small isolated groups (config, fixtures, types).',
      },
    ],
  },
  {
    id: 'ownership',
    title: 'Ownership',
    icon: '👤',
    summary: 'Per-file git ownership — who knows the code and where knowledge is concentrated.',
    items: [
      {
        term: 'Primary owner',
        def: 'The contributor with the highest share of commits touching this file.',
      },
      {
        term: 'Share %',
        def: 'Percentage of commits to this file authored by the primary owner. 100% = sole owner.',
      },
      {
        term: 'Contributors column',
        def: 'Shows "sole owner" (bus factor 1) or the count of meaningful contributors (bus factor > 1).',
      },
      {
        term: 'Bus factor risk banner',
        def: 'Appears when many files have only one contributor. If that person is unavailable, those files become a knowledge black hole.',
      },
      {
        term: 'Sole owner (highlighted in yellow)',
        def: 'This file has exactly one person who understands it. It\'s the most critical ownership risk — prioritise review, documentation, or pair programming for these files.',
      },
      {
        term: 'What to do with this data',
        def: 'Cross-reference with the Risk table. A file that is both high-churn AND sole-owner is extremely fragile. Target it for code review and knowledge transfer.',
      },
      {
        term: 'Filter',
        def: 'Filter by filename or owner name to focus on a specific contributor\'s footprint or a specific directory.',
      },
    ],
  },
];

export function Guide() {
  return (
    <div className="max-w-3xl space-y-10 pb-16">
      <div>
        <h1 className="text-white text-xl font-semibold">Guide</h1>
        <p className="mt-1 text-white/50 text-sm">
          How to read and interpret each dashboard view.
        </p>
      </div>

      {/* Quick-jump */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50 hover:border-[#603dc6]/60 hover:text-[#a78bfa] transition-colors"
          >
            {s.title}
          </a>
        ))}
      </div>

      {SECTIONS.map(section => (
        <section key={section.id} id={section.id} className="scroll-mt-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[#603dc6] text-lg select-none">{section.icon}</span>
            <h2 className="text-white font-semibold text-base">{section.title}</h2>
          </div>
          <p className="text-white/50 text-sm mb-5 leading-relaxed">{section.summary}</p>

          <div className="rounded-xl border border-white/10 bg-[#1e1d2a] overflow-hidden">
            {section.items.map((item, i) => (
              <div
                key={item.term}
                className={`flex gap-4 px-5 py-4 ${i < section.items.length - 1 ? 'border-b border-[rgba(255,255,255,0.05)]' : ''}`}
              >
                <dt className="w-36 shrink-0 text-xs font-medium text-[#a78bfa] pt-0.5 leading-relaxed">
                  {item.term}
                </dt>
                <dd className="text-sm text-white/60 leading-relaxed">{item.def}</dd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
