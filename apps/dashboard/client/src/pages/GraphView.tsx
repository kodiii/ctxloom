import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { useApi } from '../hooks/useApi.ts';
import { api } from '../lib/api.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import type { GraphNode, GraphEdge } from '../../../server/types.js';

interface SimNode extends GraphNode, d3.SimulationNodeDatum {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
}

const COMMUNITY_COLOURS = d3.schemeTableau10;

export function GraphView() {
  const state = useApi(api.graph);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (state.status !== 'success' || !svgRef.current) return;

    const { nodes, edges } = state.data;
    const topNodes = [...nodes]
      .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree))
      .slice(0, 300);
    const nodeIds = new Set(topNodes.map(n => n.id));
    const visibleEdges = edges.filter(
      e => nodeIds.has(e.source as string) && nodeIds.has(e.target as string)
    );

    const el = svgRef.current;
    const width = el.clientWidth || 900;
    const height = el.clientHeight || 600;

    const svg = d3.select(el);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    svg.call(
      d3.zoom<SVGSVGElement, unknown>().on('zoom', e => g.attr('transform', e.transform))
    );

    const simNodes: SimNode[] = topNodes.map(n => ({ ...n }));
    const nodeMap = new Map(simNodes.map(n => [n.id, n]));
    const simLinks: SimLink[] = visibleEdges
      .map(e => ({ source: nodeMap.get(e.source as string)!, target: nodeMap.get(e.target as string)! }))
      .filter(l => l.source && l.target);

    const sim = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(60))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(8));

    const link = g.append('g')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', '#d1d5db')
      .attr('stroke-width', 0.8)
      .attr('stroke-opacity', 0.6);

    const node = g.append('g')
      .selectAll('circle')
      .data(simNodes)
      .join('circle')
      .attr('r', d => 3 + Math.min(10, (d.inDegree + d.outDegree) * 0.5))
      .attr('fill', d => COMMUNITY_COLOURS[d.community % COMMUNITY_COLOURS.length])
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .call(
        d3.drag<SVGCircleElement, SimNode>()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    node.append('title').text(d => d.id);

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x ?? 0)
        .attr('y1', d => d.source.y ?? 0)
        .attr('x2', d => d.target.x ?? 0)
        .attr('y2', d => d.target.y ?? 0);
      node
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);
    });

    return () => { sim.stop(); };
  }, [state]);

  if (state.status === 'loading') return <div className="text-gray-400 text-sm">Building graph...</div>;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;

  return (
    <div className="space-y-4 h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Dependency Graph</h1>
        <span className="text-xs text-gray-400">
          {state.data.nodes.length} nodes · {state.data.edges.length} edges · scroll to zoom · drag to pan
        </span>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm" style={{ height: 'calc(100vh - 160px)' }}>
        <svg ref={svgRef} width="100%" height="100%" />
      </div>
    </div>
  );
}
