import { useMemo, useState } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDownUp, ArrowLeftRight, Building2, Check, Code2, Copy, Cpu, GitFork, Globe, Landmark, Link2, Store, Users, Wallet } from 'lucide-react';
import type { EdgeType, GraphEdgeSpec, GraphNodeSpec, Scenario } from '../../types/merchant';
import type { EvidenceItem } from '../../types/evidence';
import { Badge, Btn, Callout, StatusBadge } from '../ui/ui';
import { cx } from '../../utils/format';

export const EDGE_STYLE: Record<EdgeType, { color: string; dash?: string; label: string; blurb: string }> = {
  ENTITY_RESOLUTION: { color: '#16a34a', label: 'Entity resolution', blurb: 'Deterministic identifier match, such as a link issued to a merchant.' },
  BEHAVIOURAL_SIMILARITY: { color: '#d97706', dash: '6 4', label: 'Behavioural similarity', blurb: 'Statistical resemblance. Not proof of common ownership or identity.' },
  PAYMENT_FLOW: { color: '#dc2626', label: 'Payment flow', blurb: 'Money moving between parties.' },
  SHARED_INFRASTRUCTURE: { color: '#9333ea', dash: '3 4', label: 'Shared infrastructure', blurb: 'Common hosting, device, template or asset.' },
  WEBSITE_LINK: { color: '#2563eb', dash: '8 3', label: 'Website link', blurb: 'A payment link or checkout embedded on a page.' },
  SETTLEMENT_RELATIONSHIP: { color: '#0891b2', label: 'Settlement relationship', blurb: 'Where collected funds are paid out.' },
};

const ICON: Record<GraphNodeSpec['type'], typeof Building2> = {
  merchant: Building2,
  payer: Users,
  account: Wallet,
  link: Link2,
  website: Globe,
  device: Cpu,
  beneficiary: Landmark,
  peer: Store,
};

const NCOL: Record<GraphNodeSpec['type'], string> = {
  merchant: '#0284c7',
  payer: '#16a34a',
  account: '#ea580c',
  link: '#dc2626',
  website: '#2563eb',
  device: '#9333ea',
  beneficiary: '#d97706',
  peer: '#0d9488',
};

const STAGE_META = [
  { key: 'traffic', title: '1 · Payers & Traffic', types: new Set<GraphNodeSpec['type']>(['payer']) },
  { key: 'surfaces', title: '2 · Websites & Devices', types: new Set<GraphNodeSpec['type']>(['website', 'device']) },
  { key: 'channels', title: '3 · Payment Links & QRs', types: new Set<GraphNodeSpec['type']>(['link']) },
  { key: 'merchant', title: '4 · Declared Merchant', types: new Set<GraphNodeSpec['type']>(['merchant']) },
  { key: 'downstream', title: '5 · Payouts, Accounts & Peers', types: new Set<GraphNodeSpec['type']>(['account', 'beneficiary', 'peer']) },
] as const;

type Dir = 'LR' | 'TD';
type ViewMode = 'diagram' | 'mermaid';

const NODE_W = 216;
const NODE_H = 68;

interface NData {
  spec: GraphNodeSpec;
  dim: boolean;
  sel: boolean;
  path: boolean;
  illicitCount: number;
}

interface SubgraphData {
  title: string;
  width: number;
  height: number;
}

function SubgraphNode({ data }: NodeProps) {
  const { title, width, height } = data as unknown as SubgraphData;
  return (
    <div
      style={{ width, height }}
      className="pointer-events-none rounded-xl border border-dashed border-slate-300/90 bg-slate-100/55 px-3 py-2"
    >
      <div className="inline-flex items-center rounded bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-600 shadow-2xs ring-1 ring-slate-200/80">
        {title}
      </div>
    </div>
  );
}

function MreNode({ data }: NodeProps) {
  const { spec, dim, sel, path, illicitCount } = data as unknown as NData;
  const Icon = ICON[spec.type];
  const color = NCOL[spec.type];
  const hs = { opacity: 0, pointerEvents: 'none' as const, width: 6, height: 6 };

  const shapeCls =
    spec.type === 'payer'
      ? 'rounded-full border-2 px-3.5'
      : spec.type === 'link'
        ? 'rounded-md border border-x-4 px-3'
        : spec.type === 'beneficiary' || spec.type === 'account'
          ? 'rounded-b-xl rounded-t-sm border border-t-4 px-3'
          : spec.type === 'peer'
            ? 'rounded-lg border-2 border-dashed px-3'
            : spec.type === 'merchant'
              ? 'rounded-xl border-2 px-3.5 ring-4 ring-sky-100/80'
              : 'rounded-lg border px-3';

  return (
    <div
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        borderColor: sel ? '#4f46e5' : illicitCount > 0 && spec.type !== 'merchant' ? '#ef4444' : path ? color : spec.type === 'merchant' ? '#0284c7' : '#cbd5e1',
        backgroundColor: spec.type === 'merchant' ? '#f0f9ff' : '#ffffff',
      }}
      className={cx(
        'relative flex items-center gap-2.5 py-2 shadow-xs transition-all',
        shapeCls,
        dim && 'opacity-25',
        sel ? 'ring-2 ring-indigo-500 shadow-md' : 'hover:shadow-md',
      )}
    >
      <Handle id="t-left" type="target" position={Position.Left} style={hs} isConnectable={false} />
      <Handle id="t-right" type="target" position={Position.Right} style={hs} isConnectable={false} />
      <Handle id="t-top" type="target" position={Position.Top} style={hs} isConnectable={false} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} style={hs} isConnectable={false} />
      <Handle id="s-left" type="source" position={Position.Left} style={hs} isConnectable={false} />
      <Handle id="s-right" type="source" position={Position.Right} style={hs} isConnectable={false} />
      <Handle id="s-top" type="source" position={Position.Top} style={hs} isConnectable={false} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={hs} isConnectable={false} />

      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}18`, color }}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[12px] font-semibold text-slate-900" title={spec.label}>{spec.label}</span>
          {illicitCount > 0 && (
            <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-rose-700">
              {illicitCount} flag{illicitCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {spec.sub && <div className="truncate text-[10.5px] text-slate-500" title={spec.sub}>{spec.sub}</div>}
      </div>
    </div>
  );
}

const nodeTypes = { mre: MreNode, subgraph: SubgraphNode };

function stageIndexOf(type: GraphNodeSpec['type']): number {
  const idx = STAGE_META.findIndex(s => s.types.has(type));
  return idx >= 0 ? idx : 3;
}

/**
 * Hierarchical Mermaid-style stage layout with barycenter edge-crossing minimization.
 * Returns positions for nodes plus backdrop subgraph bounds for each populated stage.
 */
function mermaidLayout(nodes: GraphNodeSpec[], edges: GraphEdgeSpec[], dir: Dir) {
  const buckets = new Map<number, GraphNodeSpec[]>();
  for (const n of nodes) {
    const st = stageIndexOf(n.type);
    buckets.set(st, [...(buckets.get(st) ?? []), n]);
  }
  const activeStages = [...buckets.keys()].sort((a, b) => a - b);

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  }

  // Initial deterministic order inside each stage
  const order = new Map<string, number>();
  for (const st of activeStages) {
    const list = buckets.get(st)!;
    list.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
    list.forEach((n, idx) => order.set(n.id, idx));
  }

  // 3-pass barycenter sweep to minimize line crossings across adjacent stages
  for (let pass = 0; pass < 3; pass++) {
    const seq = pass % 2 === 0 ? activeStages : [...activeStages].reverse();
    for (const st of seq) {
      const list = buckets.get(st)!;
      const scored = list.map((n, origIdx) => {
        const nbrs = (adj.get(n.id) ?? []).map(id => order.get(id)).filter((v): v is number => v !== undefined);
        const avg = nbrs.length ? nbrs.reduce((s, v) => s + v, 0) / nbrs.length : origIdx;
        return { n, avg, origIdx };
      });
      scored.sort((a, b) => a.avg - b.avg || a.origIdx - b.origIdx);
      buckets.set(st, scored.map(x => x.n));
      scored.forEach((x, idx) => order.set(x.n.id, idx));
    }
  }

  const maxPerStage = Math.max(1, ...activeStages.map(st => buckets.get(st)!.length));
  const pos = new Map<string, { x: number; y: number }>();
  const subgraphs: { id: string; title: string; x: number; y: number; width: number; height: number }[] = [];

  if (dir === 'LR') {
    const colGap = 310;
    const rowGap = 104;
    const padX = 24;
    const padTop = 44;
    const padBottom = 22;
    const stageHeight = Math.max(NODE_H + padTop + padBottom, (maxPerStage - 1) * rowGap + NODE_H + padTop + padBottom);
    const centerY = stageHeight / 2;

    activeStages.forEach((st, colIdx) => {
      const list = buckets.get(st)!;
      const groupHeight = (list.length - 1) * rowGap + NODE_H;
      const startY = centerY - groupHeight / 2;
      const colX = colIdx * colGap;
      list.forEach((n, i) => {
        pos.set(n.id, { x: colX + padX, y: startY + i * rowGap });
      });
      subgraphs.push({
        id: `sg-${STAGE_META[st].key}`,
        title: STAGE_META[st].title,
        x: colX,
        y: 0,
        width: NODE_W + padX * 2,
        height: stageHeight,
      });
    });
  } else {
    const rowGap = 152;
    const colGap = 246;
    const padX = 24;
    const padTop = 40;
    const padBottom = 20;
    const stageWidth = Math.max(NODE_W + padX * 2, (maxPerStage - 1) * colGap + NODE_W + padX * 2);
    const centerX = stageWidth / 2;

    activeStages.forEach((st, rowIdx) => {
      const list = buckets.get(st)!;
      const groupWidth = (list.length - 1) * colGap + NODE_W;
      const startX = centerX - groupWidth / 2;
      const rowY = rowIdx * rowGap;
      list.forEach((n, i) => {
        pos.set(n.id, { x: startX + i * colGap, y: rowY + padTop });
      });
      subgraphs.push({
        id: `sg-${STAGE_META[st].key}`,
        title: STAGE_META[st].title,
        x: 0,
        y: rowY,
        width: stageWidth,
        height: NODE_H + padTop + padBottom,
      });
    });
  }

  return { pos, subgraphs };
}

function chooseHandles(
  sPos: { x: number; y: number } | undefined,
  tPos: { x: number; y: number } | undefined,
): { sourceHandle: string; targetHandle: string } {
  if (!sPos || !tPos) return { sourceHandle: 's-right', targetHandle: 't-left' };
  const dx = tPos.x - sPos.x;
  const dy = tPos.y - sPos.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { sourceHandle: 's-right', targetHandle: 't-left' } : { sourceHandle: 's-left', targetHandle: 't-right' };
  }
  return dy >= 0 ? { sourceHandle: 's-bottom', targetHandle: 't-top' } : { sourceHandle: 's-top', targetHandle: 't-bottom' };
}

function pathFrom(root: string, target: string, edges: GraphEdgeSpec[]) {
  const prev = new Map<string, { n: string; e: string }>(), q = [root], seen = new Set([root]);
  while (q.length) {
    const x = q.shift()!;
    for (const e of edges) {
      const y = e.source === x ? e.target : e.target === x ? e.source : null;
      if (y && !seen.has(y)) { seen.add(y); prev.set(y, { n: x, e: e.id }); q.push(y); }
    }
  }
  const ns = new Set([target]), es = new Set<string>();
  let c = target;
  while (prev.has(c)) { const p = prev.get(c)!; es.add(p.e); ns.add(p.n); c = p.n; }
  return { ns: c === root ? ns : new Set([target]), es: c === root ? es : new Set<string>() };
}

function escMermaid(s: string): string {
  return s.replaceAll('"', "'").replaceAll('\n', ' ');
}

function toMermaidSource(nodes: GraphNodeSpec[], edges: GraphEdgeSpec[], evidence: EvidenceItem[], dir: Dir): string {
  const evMap = new Map(evidence.map(e => [e.id, e]));
  const lines: string[] = [`flowchart ${dir}`];
  const nodeShape = (n: GraphNodeSpec) => {
    const text = escMermaid(n.sub ? `${n.label}<br/>${n.sub}` : n.label);
    if (n.type === 'payer') return `${n.id}(["${text}"])`;
    if (n.type === 'link') return `${n.id}[["${text}"]]`;
    if (n.type === 'beneficiary' || n.type === 'account') return `${n.id}[("${text}")]`;
    if (n.type === 'merchant') return `${n.id}{{"${text}"}}`;
    return `${n.id}["${text}"]`;
  };
  for (const stage of STAGE_META) {
    const group = nodes.filter(n => stage.types.has(n.type));
    if (!group.length) continue;
    lines.push(`  subgraph ${stage.key}["${stage.title}"]`);
    for (const n of group) lines.push(`    ${nodeShape(n)}:::${n.type}`);
    lines.push('  end');
  }
  for (const e of edges) {
    const fired = e.evidence.filter(id => evMap.get(id)?.status === 'ILLICIT');
    const lbl = [e.label, fired.length ? `[${fired.join(',')}]` : ''].filter(Boolean).join(' ');
    const arrow = e.type === 'PAYMENT_FLOW' ? '==>' : e.type === 'BEHAVIOURAL_SIMILARITY' || e.type === 'SHARED_INFRASTRUCTURE' || e.type === 'WEBSITE_LINK' ? '-.->' : '-->';
    lines.push(lbl ? `  ${e.source} ${arrow}|"${escMermaid(lbl)}"| ${e.target}` : `  ${e.source} ${arrow} ${e.target}`);
  }
  lines.push(
    '  classDef merchant fill:#f0f9ff,stroke:#0284c7,stroke-width:2px,color:#0f172a',
    '  classDef payer fill:#f0fdf4,stroke:#16a34a,stroke-width:2px,color:#0f172a',
    '  classDef link fill:#fef2f2,stroke:#dc2626,stroke-width:2px,color:#0f172a',
    '  classDef website fill:#eff6ff,stroke:#2563eb,color:#0f172a',
    '  classDef device fill:#faf5ff,stroke:#9333ea,color:#0f172a',
    '  classDef beneficiary fill:#fffbeb,stroke:#d97706,color:#0f172a',
    '  classDef account fill:#fff7ed,stroke:#ea580c,color:#0f172a',
    '  classDef peer fill:#f0fdfa,stroke:#0d9488,stroke-dasharray:5 3,color:#0f172a',
  );
  return lines.join('\n');
}

export function EvidenceGraph({ scenario, evidence, height = 700 }: { scenario: Scenario; evidence: EvidenceItem[]; height?: number }) {
  const { nodes: ns, edges: es } = scenario.graph;
  const [types, setTypes] = useState<Set<EdgeType>>(new Set(Object.keys(EDGE_STYLE) as EdgeType[]));
  const [selN, setSelN] = useState<string | null>(null);
  const [selE, setSelE] = useState<string | null>(null);
  const [dir, setDir] = useState<Dir>('LR');
  const [viewMode, setViewMode] = useState<ViewMode>('diagram');
  const [copied, setCopied] = useState(false);

  const vis = useMemo(() => es.filter(e => types.has(e.type)), [es, types]);
  const { pos, subgraphs } = useMemo(() => mermaidLayout(ns, vis, dir), [ns, vis, dir]);
  const root = ns.find(n => n.type === 'merchant')?.id ?? ns[0]?.id ?? '';
  const hl = useMemo(() => (selN && selN !== root ? pathFrom(root, selN, vis) : { ns: new Set<string>(), es: new Set<string>() }), [selN, root, vis]);
  const focus = selN !== null || selE !== null;
  const selEdge = es.find(e => e.id === selE);
  const litNodes = useMemo(() => {
    const s = new Set<string>(hl.ns);
    if (selN) { s.add(selN); vis.forEach(e => { if (e.source === selN) s.add(e.target); if (e.target === selN) s.add(e.source); }); }
    if (selEdge) { s.add(selEdge.source); s.add(selEdge.target); }
    return s;
  }, [hl, selN, vis, selEdge]);

  const evById = useMemo(() => new Map(evidence.map(e => [e.id, e])), [evidence]);
  const nodeIllicitCount = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of vis) {
      const bad = e.evidence.filter(id => evById.get(id)?.status === 'ILLICIT');
      if (!bad.length) continue;
      for (const nodeId of [e.source, e.target]) {
        if (!m.has(nodeId)) m.set(nodeId, new Set());
        bad.forEach(id => m.get(nodeId)!.add(id));
      }
    }
    return m;
  }, [vis, evById]);

  const nodes: Node[] = [
    ...subgraphs.map(sg => ({
      id: sg.id,
      type: 'subgraph',
      position: { x: sg.x, y: sg.y },
      data: { title: sg.title, width: sg.width, height: sg.height } as unknown as Record<string, unknown>,
      selectable: false,
      draggable: false,
      zIndex: -1,
    })),
    ...ns.map(n => ({
      id: n.id,
      type: 'mre',
      position: pos.get(n.id)!,
      data: {
        spec: n,
        dim: focus && !litNodes.has(n.id),
        sel: n.id === selN,
        path: hl.ns.has(n.id),
        illicitCount: nodeIllicitCount.get(n.id)?.size ?? 0,
      } as unknown as Record<string, unknown>,
    })),
  ];

  const dense = vis.length > 18;
  const edges: Edge[] = vis.map(e => {
    const st = EDGE_STYLE[e.type];
    const fired = e.evidence.filter(id => evById.get(id)?.status === 'ILLICIT');
    const lit = hl.es.has(e.id) || e.id === selE || (selN !== null && (e.source === selN || e.target === selN));
    const showLabel = lit || fired.length > 0 || !dense;
    const baseText = e.label ? (e.label.length > 34 ? `${e.label.slice(0, 32)}…` : e.label) : '';
    const fullLabel = fired.length ? `${baseText ? `${baseText} ` : ''}[${fired.join(', ')}]` : baseText;
    const handles = chooseHandles(pos.get(e.source), pos.get(e.target));
    const directed = e.type !== 'BEHAVIOURAL_SIMILARITY';

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: 'smoothstep',
      pathOptions: { borderRadius: 10, offset: 24 },
      animated: e.type === 'PAYMENT_FLOW' && (!focus || lit),
      label: showLabel && fullLabel ? fullLabel : undefined,
      labelStyle: {
        fill: fired.length ? '#9f1239' : '#1e293b',
        fontSize: 10.5,
        fontWeight: fired.length || lit ? 600 : 500,
      },
      labelBgStyle: {
        fill: fired.length ? '#fff1f2' : '#ffffff',
        fillOpacity: 0.95,
        stroke: fired.length ? '#fecdd3' : '#e2e8f0',
        strokeWidth: 0.8,
      },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      style: {
        stroke: st.color,
        strokeWidth: lit ? 2.8 : e.type === 'PAYMENT_FLOW' ? 2.2 : e.type === 'BEHAVIOURAL_SIMILARITY' ? 1.5 : 1.8,
        strokeDasharray: st.dash,
        opacity: focus && !lit ? 0.14 : 0.92,
      },
      markerEnd: directed ? { type: MarkerType.ArrowClosed, color: st.color, width: 15, height: 15 } : undefined,
    };
  });

  const mermaidText = useMemo(() => toMermaidSource(ns, vis, evidence, dir), [ns, vis, evidence, dir]);
  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(mermaidText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  const node = ns.find(n => n.id === selN);
  const incident = node ? es.filter(e => e.source === node.id || e.target === node.id) : selEdge ? [selEdge] : [];
  const nm = (id: string) => ns.find(n => n.id === id)?.label ?? id;
  const evOf = (ids: string[]) => ids.map(i => evidence.find(e => e.id === i)).filter((x): x is EvidenceItem => !!x);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(EDGE_STYLE) as EdgeType[]).map(t => {
              const on = types.has(t), st = EDGE_STYLE[t];
              return (
                <button
                  key={t}
                  onClick={() => setTypes(p => { const n = new Set(p); on ? n.delete(t) : n.add(t); return n; })}
                  title={st.blurb}
                  className={cx(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    on ? 'border-slate-300 bg-white text-slate-900 shadow-2xs' : 'border-slate-200 bg-slate-50 text-slate-400',
                  )}
                >
                  <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={st.color} strokeWidth="2.2" strokeDasharray={st.dash} opacity={on ? 1 : 0.35} /></svg>
                  {st.label}
                </button>
              );
            })}
            {focus && <Btn size="sm" variant="ghost" onClick={() => { setSelN(null); setSelE(null); }}>Clear selection</Btn>}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                onClick={() => setDir('LR')}
                className={cx('flex items-center gap-1 rounded px-2 py-1 font-medium transition', dir === 'LR' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600')}
                title="Left-to-right Mermaid layout"
              >
                <ArrowLeftRight size={13} /> LR
              </button>
              <button
                onClick={() => setDir('TD')}
                className={cx('flex items-center gap-1 rounded px-2 py-1 font-medium transition', dir === 'TD' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600')}
                title="Top-down Mermaid layout"
              >
                <ArrowDownUp size={13} /> TD
              </button>
            </div>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                onClick={() => setViewMode('diagram')}
                className={cx('flex items-center gap-1 rounded px-2.5 py-1 font-medium transition', viewMode === 'diagram' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600')}
              >
                <GitFork size={13} /> Diagram
              </button>
              <button
                onClick={() => setViewMode('mermaid')}
                className={cx('flex items-center gap-1 rounded px-2.5 py-1 font-medium transition', viewMode === 'mermaid' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600')}
              >
                <Code2 size={13} /> Mermaid
              </button>
            </div>
          </div>
        </div>

        {viewMode === 'diagram' ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs" style={{ height }}>
            <ReactFlow
              key={`${scenario.id}-${dir}`}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              minZoom={0.25}
              maxZoom={2.2}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => { if (n.type === 'subgraph') return; setSelN(n.id); setSelE(null); }}
              onEdgeClick={(_, e) => { setSelE(e.id); setSelN(null); }}
              onPaneClick={() => { setSelN(null); setSelE(null); }}
            >
              <Background variant={BackgroundVariant.Dots} color="#cbd5e1" gap={22} size={1.1} />
              <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={n => n.type === 'subgraph' ? '#f1f5f9' : '#cbd5e1'} className="!border !border-slate-200 !bg-white/95" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        ) : (
          <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100 shadow-xs" style={{ height }}>
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2.5 text-xs">
              <span className="font-mono text-slate-300">flowchart {dir} · Mermaid specification ({ns.length} nodes, {vis.length} edges)</span>
              <Btn size="sm" variant="outline" onClick={copyMermaid}>
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy Mermaid</>}
              </Btn>
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-emerald-200">{mermaidText}</pre>
          </div>
        )}
        <div className="text-xs text-mute">
          Mermaid stage flow ({dir === 'LR' ? 'left-to-right' : 'top-down'}). Shapes encode role: pills = payers, double-bar = links/QRs, ledger header = accounts/beneficiaries, dashed = peers. Click any node or arrow to inspect attached evidence.
        </div>
      </div>

      <div className="space-y-3">
        <Callout tone="warn" title="Similarity is not identity">Behavioural-similarity and shared-infrastructure edges are leads for a human to verify. They are never treated as proof of common ownership.</Callout>
        <div className="rounded-xl border border-line bg-panel shadow-xs">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">{node ? node.label : selEdge ? `${nm(selEdge.source)} → ${nm(selEdge.target)}` : 'Inspector'}</div>
          <div className="space-y-3 p-4 text-sm">
            {!node && !selEdge && <div className="text-mute">Select a node or an edge to see its relationships and the evidence behind them.</div>}
            {node && (
              <div className="space-y-1 text-mute">
                <Badge tone="info">{node.type}</Badge>
                {node.sub && <div>{node.sub}</div>}
                {node.note && <div className="text-slate-700">{node.note}</div>}
                {hl.es.size > 0 && <div className="text-xs text-dim">Path from merchant: {hl.es.size} hop{hl.es.size > 1 ? 's' : ''} highlighted.</div>}
              </div>
            )}
            {incident.map(e => (
              <div key={e.id} className="rounded border border-line bg-panel2 p-3">
                <div className="mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: EDGE_STYLE[e.type].color }} /><span className="text-xs font-medium">{EDGE_STYLE[e.type].label}</span></div>
                <div className="text-[13px] text-ink">{nm(e.source)} → {nm(e.target)}</div><div className="text-xs text-mute">{e.label}</div>
                {e.note && <div className="mt-1.5 text-xs text-slate-700">{e.note}</div>}
                {evOf(e.evidence).map(ev => (
                  <div key={ev.id} className="mt-2 border-t border-line pt-2">
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{ev.id} {ev.name}</span><StatusBadge s={ev.status} /></div>
                    <div className="mt-0.5 text-xs text-mute">{ev.observed}</div>
                  </div>
                ))}
                {!e.evidence.length && <div className="mt-1.5 text-[11px] text-dim">No detector evidence attached to this edge.</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
