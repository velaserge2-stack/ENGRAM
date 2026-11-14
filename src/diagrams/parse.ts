import {
  MAX_LINE,
  MAX_NODES,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramError,
  type DiagramKind,
  type DiagramNode,
  type ParseResult,
  type Shape,
} from './types';

const FORMS: { open: string; close: string; shape: Shape }[] = [
  { open: '[/', close: '/]', shape: 'io' },
  { open: '<<', close: '>>', shape: 'note' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
];
const ESCAPABLE = '])}>/\\';

interface Suffix { x?: number; y?: number; folded?: boolean; route?: DiagramEdge['route'] }

// Sufijos solo al final de la línea, con estas claves exactas (decisión 5).
function stripSuffixes(s: string): { rest: string; suf: Suffix } {
  const suf: Suffix = {};
  for (;;) {
    let m = /\s*\{(recta|curva|orto)\}$/.exec(s);
    if (m) { suf.route ??= m[1] as Suffix['route']; s = s.slice(0, m.index); continue; }
    m = /\s*\{x=(-?\d+),y=(-?\d+)\}$/.exec(s);
    if (m) { suf.x ??= Number(m[1]); suf.y ??= Number(m[2]); s = s.slice(0, m.index); continue; }
    m = /\s*\{plegado\}$/.exec(s);
    if (m) { suf.folded = true; s = s.slice(0, m.index); continue; }
    return { rest: s, suf };
  }
}

interface Tok { shape: Shape; text: string; end: number }

function readNode(s: string, i: number): Tok | null {
  for (const f of FORMS) {
    if (!s.startsWith(f.open, i)) continue;
    let text = '';
    for (let j = i + f.open.length; j < s.length; j++) {
      if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.includes(s[j + 1]!)) { text += s[j + 1]; j++; continue; }
      if (s.startsWith('[[', j)) { // enlace [[nota]]: se copia entero, no cierra la forma
        const e = s.indexOf(']]', j + 2);
        if (e > 0) { text += s.slice(j, e + 2); j = e + 1; continue; }
      }
      if (s.startsWith(f.close, j)) {
        text = text.trim();
        return text ? { shape: f.shape, text, end: j + f.close.length } : null;
      }
      text += s[j];
    }
    // `[/` sin cierre `/]`: la forma `[` lo intenta en la vuelta siguiente.
  }
  return null;
}

interface Arrow { arrow: DiagramEdge['arrow']; label?: string; end: number }

function readArrow(s: string, i: number, kind: DiagramKind): Arrow | null {
  const r = s.slice(i);
  if (r.startsWith('-->')) return { arrow: 'to', end: i + 3 };
  if (kind === 'diagrama' && r.startsWith('<-->')) return { arrow: 'both', end: i + 4 };
  if (kind === 'diagrama' && r.startsWith('---')) return { arrow: 'none', end: i + 3 };
  const m = /^--\s+(.*?)\s*(-->|---)/.exec(r);
  if (m && (m[2] === '-->' || kind === 'diagrama')) {
    return { arrow: m[2] === '-->' ? 'to' : 'none', label: m[1] || undefined, end: i + m[0].length };
  }
  return null;
}

const skipWs = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i]!)) i++; return i; };

interface Flow { toks: Tok[]; arrows: Arrow[] }

function parseFlowBody(s: string, kind: DiagramKind): Flow | null {
  const toks: Tok[] = [];
  const arrows: Arrow[] = [];
  let i = skipWs(s, 0);
  for (;;) {
    const t = readNode(s, i);
    if (!t) return null;
    toks.push(t);
    i = skipWs(s, t.end);
    if (i >= s.length) return { toks, arrows };
    const a = readArrow(s, i, kind);
    if (!a) return null;
    arrows.push(a);
    i = skipWs(s, a.end);
  }
}

export function parseDiagram(text: string, kind: DiagramKind): ParseResult {
  // CRLF solo si todos los saltos lo son; si no, el \r queda dentro de la línea (ida y vuelta exacta).
  const crlf = text.includes('\r\n') && !/(^|[^\r])\n/.test(text);
  const eol = crlf ? '\r\n' : '\n';
  const rawLines = text === '' ? [] : text.split(eol);
  const doc: DiagramDoc = { kind, nodes: [], edges: [], lines: [], eol };
  const errors: DiagramError[] = [];
  const byKey = new Map<string, DiagramNode>();
  const stack: DiagramNode[] = []; // mapa: último nodo por profundidad
  let rootSeen = false;

  const bad = (raw: string, code: DiagramError['code']) => {
    errors.push({ line: doc.lines.length, code });
    doc.lines.push({ t: 'raw', raw });
  };
  const addNode = (n: Omit<DiagramNode, 'id' | 'line'>, suf: Suffix): DiagramNode => {
    const hit = kind === 'mapa' ? undefined : byKey.get(`${n.shape}\u0000${n.text}`);
    if (hit) { // vale la primera posición escrita
      if (hit.x === undefined && suf.x !== undefined) { hit.x = suf.x; hit.y = suf.y; }
      if (suf.folded) hit.folded = true;
      return hit;
    }
    const node: DiagramNode = { ...n, id: `n${doc.nodes.length}`, line: doc.lines.length };
    if (suf.x !== undefined) { node.x = suf.x; node.y = suf.y; }
    if (suf.folded) node.folded = true;
    doc.nodes.push(node);
    byKey.set(`${n.shape}\u0000${n.text}`, node);
    return node;
  };

  for (const raw of rawLines) {
    if (raw.trim() === '' || raw.startsWith('#')) { doc.lines.push({ t: 'raw', raw }); continue; }
    if (raw.length > MAX_LINE) { bad(raw, 'forma'); continue; }

    if (kind === 'mapa') {
      const lead = /^[ \t]*/.exec(raw)![0];
      const spaces = lead.replace(/\t/g, '  ').length;
      const body = raw.slice(lead.length).trimEnd();
      if (!rootSeen) {
        if (spaces !== 0 || body.startsWith('-')) { bad(raw, 'forma'); continue; }
        const { rest, suf } = stripSuffixes(body);
        if (!rest) { bad(raw, 'forma'); continue; }
        rootSeen = true;
        const n = addNode({ shape: 'rect', text: rest, depth: 0 }, suf);
        stack[0] = n;
        doc.lines.push({ t: 'node', node: n.id, raw });
        continue;
      }
      const m = /^- (.+)$/.exec(body);
      if (!m) { bad(raw, body.startsWith('-') ? 'forma' : 'desconocida'); continue; }
      if (spaces % 2 !== 0) { bad(raw, 'sangria'); continue; }
      const depth = spaces / 2 + 1;
      const parent = stack[depth - 1];
      if (!parent) { bad(raw, 'sangria'); continue; }
      const { rest, suf } = stripSuffixes(m[1]!.trim());
      if (!rest) { bad(raw, 'forma'); continue; }
      const n = addNode({ shape: 'rect', text: rest, depth, parent: parent.id }, suf);
      stack.length = depth;
      stack[depth] = n;
      doc.lines.push({ t: 'node', node: n.id, raw });
      continue;
    }

    // flujo y diagrama
    const body = raw.trim();
    const stripped = stripSuffixes(body);
    let suf = stripped.suf;
    let flow = stripped.rest ? parseFlowBody(stripped.rest, kind) : null;
    if (!flow) { suf = {}; flow = parseFlowBody(body, kind); } // p. ej. `{plegado}` como decisión
    if (!flow) { bad(raw, 'forma'); continue; }

    const lineIdx = doc.lines.length;
    const last = flow.toks.length - 1;
    const nodes = flow.toks.map((t, k) => addNode({ shape: t.shape, text: t.text, depth: 0 }, k === last ? suf : {}));
    if (flow.arrows.length === 0) { doc.lines.push({ t: 'node', node: nodes[0]!.id, raw }); continue; }
    const ids: string[] = [];
    flow.arrows.forEach((a, k) => {
      const e: DiagramEdge = {
        id: `e${doc.edges.length}`, from: nodes[k]!.id, to: nodes[k + 1]!.id, arrow: a.arrow, line: lineIdx,
      };
      if (a.label) e.label = a.label;
      if (k === flow.arrows.length - 1 && suf.route) e.route = suf.route;
      doc.edges.push(e);
      ids.push(e.id);
    });
    doc.lines.push({ t: 'edge', edges: ids, raw });
  }

  const truncated = doc.nodes.length > MAX_NODES;
  if (truncated) errors.push({ line: doc.nodes[MAX_NODES]!.line, code: 'tope' });
  return { doc, errors, truncated, tooBig: truncated };
}
