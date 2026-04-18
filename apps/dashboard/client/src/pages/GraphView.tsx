import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { FileDrawer } from '../components/FileDrawer.tsx';
import type { GraphNode, GraphEdge } from '../../../server/types.js';

interface SimNode extends GraphNode, d3.SimulationNodeDatum {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
}

interface TooltipData {
  id: string;
  label: string;
  inDegree: number;
  outDegree: number;
  riskScore: number | null;
}

interface TooltipPos {
  x: number;
  y: number;
}

const COMMUNITY_COLOURS = d3.schemeTableau10;

function getFilename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function GraphView() {
  const state = useApi(api.graph);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);

  const [hoveredNode, setHoveredNode] = useState<TooltipData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [communities, setCommunities] = useState<number[]>([]);

  // Pan to a node matching the search query
  const panToNode = useCallback((query: string) => {
    if (!query.trim() || !svgRef.current || !zoomRef.current) return;
    const lower = query.toLowerCase();
    const match = simNodesRef.current.find(
      n => getFilename(n.id).toLowerCase().includes(lower) || n.id.toLowerCase().includes(lower)
    );
    if (match && match.x != null && match.y != null) {
      const svg = d3.select(svgRef.current);
      svg.transition().duration(500).call(
        zoomRef.current.translateTo,
        match.x,
        match.y
      );
    }
  }, []);

  // Re-pan whenever query changes
  useEffect(() => {
    panToNode(searchQuery);
  }, [searchQuery, panToNode]);

  useEffect(() => {
    if (state.status !== 'success' || !svgRef.current) return;

    const { nodes, edges } = state.data;
    const topNodes = [...nodes]
      .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree))
      .slice(0, 300);
    const nodeIds = new Set(topNodes.map(n => n.id));
    const visibleEdges = edges.filter(
      (e: GraphEdge) => nodeIds.has(e.source as string) && nodeIds.has(e.target as string)
    );

    // Unique communities in top 300
    const uniqueCommunities = [...new Set(topNodes.map(n => n.community))].sort((a, b) => a - b);
    setCommunities(uniqueCommunities);

    // Top 15 hub nodes for labels
    const top15Hubs = new Set(
      [...topNodes]
        .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree))
        .slice(0, 15)
        .map(n => n.id)
    );

    const el = svgRef.current;
    const width = el.clientWidth || 900;
    const height = el.clientHeight || 600;

    const svg = d3.select(el);
    svg.selectAll('*').remove();

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', e => g.attr('transform', e.transform));
    zoomRef.current = zoom;
    svg.call(zoom);

    // Click on background to deselect
    svg.on('click', (event) => {
      if (event.target === el) {
        setSelectedNodeId(null);
      }
    });

    const simNodes: SimNode[] = topNodes.map(n => ({ ...n }));
    simNodesRef.current = simNodes;
    const nodeMap = new Map(simNodes.map(n => [n.id, n]));
    const simLinks: SimLink[] = visibleEdges
      .map((e: GraphEdge) => ({
        source: nodeMap.get(e.source as string)!,
        target: nodeMap.get(e.target as string)!,
      }))
      .filter((l: SimLink) => l.source && l.target);

    // Build adjacency for highlight
    const adjacencySet = new Map<string, Set<string>>();
    for (const n of simNodes) adjacencySet.set(n.id, new Set());
    for (const l of simLinks) {
      adjacencySet.get(l.source.id)?.add(l.target.id);
      adjacencySet.get(l.target.id)?.add(l.source.id);
    }

    const sim = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(8));

    // Links
    const link = g.append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', 'rgba(255,255,255,0.1)')
      .attr('stroke-width', 0.8)
      .attr('stroke-opacity', 0.6);

    // Node groups
    const nodeGroup = g.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Risk ring (outer) for high-risk nodes
    nodeGroup
      .filter(d => (d.riskScore ?? 0) > 0.6)
      .append('circle')
      .attr('class', 'risk-ring')
      .attr('r', d => 3 + Math.min(10, (d.inDegree + d.outDegree) * 0.5) + 3)
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => (d.riskScore ?? 0) > 0.8 ? 2.5 : 1.5);

    // Main node circle
    const nodeCirlce = nodeGroup.append('circle')
      .attr('r', d => 3 + Math.min(10, (d.inDegree + d.outDegree) * 0.5))
      .attr('fill', d => COMMUNITY_COLOURS[d.community % COMMUNITY_COLOURS.length])
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 1);

    // Hub labels (top 15)
    const hubLabel = nodeGroup
      .filter(d => top15Hubs.has(d.id))
      .append('text')
      .attr('dy', d => 3 + Math.min(10, (d.inDegree + d.outDegree) * 0.5) + 11)
      .attr('text-anchor', 'middle')
      .attr('font-size', 9)
      .attr('fill', 'rgba(255,255,255,0.6)')
      .attr('pointer-events', 'none')
      .text(d => getFilename(d.id));

    // Hover events — use the node group
    nodeGroup
      .on('mouseover', (_event, d) => {
        setHoveredNode({
          id: d.id,
          label: d.label,
          inDegree: d.inDegree,
          outDegree: d.outDegree,
          riskScore: d.riskScore,
        });
      })
      .on('mousemove', (event: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        setTooltipPos({
          x: event.clientX - rect.left + 12,
          y: event.clientY - rect.top - 8,
        });
      })
      .on('mouseout', () => {
        setHoveredNode(null);
      })
      .on('click', (event: MouseEvent, d: SimNode) => {
        event.stopPropagation();
        setSelectedNodeId(prev => (prev === d.id ? null : d.id));
        setSelectedFile(d.id);
      });

    // Apply highlight based on selectedNodeId via a D3 subscription
    // We re-apply on every selection change using a separate effect-like pattern
    // by listening to a custom event or using a ref to the update function.
    // Because D3 owns the DOM here, we expose an update function via ref.
    function applyHighlight(selected: string | null) {
      if (selected === null) {
        nodeGroup.attr('opacity', 1);
        nodeCirlce.attr('opacity', 1);
        link.attr('opacity', 0.6);
      } else {
        const neighbors = adjacencySet.get(selected) ?? new Set<string>();
        nodeGroup.attr('opacity', (d: SimNode) =>
          d.id === selected || neighbors.has(d.id) ? 1 : 0.15
        );
        link.attr('opacity', (d: SimLink) => {
          const src = (d.source as SimNode).id;
          const tgt = (d.target as SimNode).id;
          return src === selected || tgt === selected ? 0.9 : 0.05;
        });
      }
    }

    // Store applyHighlight so we can call it from a separate effect
    (svgRef.current as SVGSVGElement & { _applyHighlight?: (id: string | null) => void })._applyHighlight = applyHighlight;

    sim.on('tick', () => {
      link
        .attr('x1', (d: SimLink) => d.source.x ?? 0)
        .attr('y1', (d: SimLink) => d.source.y ?? 0)
        .attr('x2', (d: SimLink) => d.target.x ?? 0)
        .attr('y2', (d: SimLink) => d.target.y ?? 0);

      nodeGroup.attr('transform', (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);

      // Suppress TS — hubLabel positions are already driven by parent transform
      void hubLabel;

      // Search pulse: find matching node, add pulse animation via attr
      // (panning is handled separately via the searchQuery effect)
    });

    sim.on('end', () => {
      // After layout settles, update simNodesRef so panToNode works
      simNodesRef.current = simNodes;
    });

    return () => {
      sim.stop();
      (svgRef.current as (SVGSVGElement & { _applyHighlight?: unknown }) | null)
        && delete (svgRef.current as SVGSVGElement & { _applyHighlight?: unknown })._applyHighlight;
    };
  }, [state]);

  // Apply highlight whenever selectedNodeId changes
  useEffect(() => {
    if (!svgRef.current) return;
    const fn = (svgRef.current as SVGSVGElement & { _applyHighlight?: (id: string | null) => void })._applyHighlight;
    if (fn) fn(selectedNodeId);
  }, [selectedNodeId]);

  if (state.status === 'loading') return <div className="text-white/40 text-sm">Building graph...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  return (
    <div className="space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-xl font-semibold">Dependency Graph</h1>
        <span className="text-xs text-white/40">
          {state.data.nodes.length} nodes · {state.data.edges.length} edges · scroll to zoom · drag to pan
        </span>
      </div>

      <div
        ref={containerRef}
        className="rounded-xl border border-white/10 bg-[#18181f] relative overflow-hidden"
        style={{ height: 'calc(100vh - 160px)' }}
      >
        {/* Search box */}
        <div className="absolute top-3 right-3 z-10">
          <input
            type="text"
            placeholder="Search node..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-[#131220] border border-white/10 text-white placeholder:text-white/30 rounded-md px-2 py-1 text-xs w-48 outline-none focus:ring-1 focus:ring-[#603dc6]/50"
          />
        </div>

        {/* Community legend */}
        {communities.length > 0 && (
          <div
            className="absolute bottom-3 left-3 z-10 bg-[#1e1d2a] border border-white/10 rounded-lg px-3 py-2 max-h-48 overflow-y-auto"
            aria-label="Community legend"
          >
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">Communities</p>
            <div className="space-y-1">
              {communities.map(c => (
                <div key={c} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COMMUNITY_COLOURS[c % COMMUNITY_COLOURS.length] }}
                  />
                  <span className="text-white/60 text-[10px]">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ background: '#18181f', borderRadius: '0.75rem' }}
        />

        {/* Floating tooltip */}
        {hoveredNode && (
          <div
            className="absolute pointer-events-none z-20 bg-[#1e1d2a] border border-white/10 rounded-lg px-3 py-2 text-xs text-white shadow-lg"
            style={{ left: tooltipPos.x, top: tooltipPos.y, maxWidth: 260 }}
            role="tooltip"
          >
            <p className="font-bold truncate">{getFilename(hoveredNode.id)}</p>
            <p className="text-white/40 truncate mt-0.5">{hoveredNode.id}</p>
            <div className="mt-2 space-y-0.5 text-white/70">
              <p>In-degree: <span className="text-white">{hoveredNode.inDegree}</span></p>
              <p>Out-degree: <span className="text-white">{hoveredNode.outDegree}</span></p>
              <p>
                Risk score:{' '}
                <span className="text-white">
                  {hoveredNode.riskScore != null ? hoveredNode.riskScore.toFixed(2) : '—'}
                </span>
              </p>
            </div>
          </div>
        )}
      </div>
      <FileDrawer file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
}
