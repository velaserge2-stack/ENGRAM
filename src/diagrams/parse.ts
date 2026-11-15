import {
  BACKDROPS,
  MAX_LINE,
  MAX_NODES,
  MAX_TEXT,
  type Backdrop,
  type Color,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramError,
  type DiagramKind,
  type DiagramNode,
  type EdgeAttrs,
  type EdgeEnd,
  type NodeAttrs,
  type Route,
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

// --- Grupos de sufijos `{k=v,flag,…}` (§P22.1) ---
const NODE_KV = new Set(['x', 'y', 'color', 'w', 'h', 'maxw', 'fs']);
const FLAGS = new Set(['plegado', 'dash', 'recta', 'curva', 'orto']);
export const ROUTES = ['recta', 'curva', 'orto'] as const;
export const ENDS: readonly EdgeEnd[] = ['sin', 'flecha', 'ambos', 'circulo', 'rombo'];
// En una línea con flechas estas claves son del nodo; el resto (color, w, dash, fin, rutas) de la última flecha.
export const NODE_ONLY = new Set(['x', 'y', 'h', 'maxw', 'fs', 'plegado']);

export const itemKey = (it: string) => { const t = it.trim(); const i = t.indexOf('='); return i < 0 ? t : t.slice(0, i).trim(); };
const itemVal = (it: string) => { const i = it.indexOf('='); return i < 0 ? '' : it.slice(i + 1).trim(); };
const known = (it: string) => { const t = it.trim(); const i = t.indexOf('='); return i < 0 ? FLAGS.has(t) : NODE_KV.has(t.slice(0, i).trim()) || t.slice(0, i).trim() === 'fin'; };
const generic = (items: string[]) => items.every((it) => /^[A-Za-z_][\w.-]*(=[^,{}]*)?$/.test(it.trim()));

function peel(s: string, ok: (items: string[]) => boolean) {
  const groups: string[][] = []; // de izquierda a derecha
  for (;;) {
    const m = /\s*\{([^{}]*)\}$/.exec(s);
    if (!m) break;
    const items = m[1]!.split(',');
    if (!ok(items)) break;
    groups.unshift(items);
    s = s.slice(0, m.index);
  }
  return { rest: s, groups };
}

// Sufijo = grupos finales con ≥ 1 clave conocida.
export function stripSuffixes(s: string): { rest: string; groups: string[][] } {
  return peel(s, (it) => it.some(known));
}

export interface Cand { rest: string; tail: string; groups: string[][] }
// Lecturas posibles de una línea de flujo, en orden: con sufijos conocidos, sin sufijos (`{plegado}` como decisión)
// y, si nada encaja, con cualquier grupo `{clave=valor}` final (p. ej. `[A] {c=3}`: queda en `extra`).
export function suffixCandidates(body: string): Cand[] {
  const k = stripSuffixes(body);
  const out: Cand[] = [{ ...k, tail: body.slice(k.rest.length) }];
  if (k.groups.length) out.push({ rest: body, tail: '', groups: [] });
  const g = peel(body, generic);
  if (g.groups.length && !out.some((c) => c.rest === g.rest)) out.push({ ...g, tail: body.slice(g.rest.length) });
  return out;
}

const int = (v: string) => (/^-?\d+$/.test(v) ? Number(v) : NaN);
const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

// Lee ítems (grupos de derecha a izquierda: gana el más a la derecha). Lo no entendido va a `extra`.
export function readNodeItems(groups: string[][]): { attrs: NodeAttrs; extra: string[] } {
  const attrs: NodeAttrs = {};
  const extra: string[] = [];
  for (let g = groups.length - 1; g >= 0; g--) {
    const items = groups[g]!;
    const xi = items.findIndex((it) => itemKey(it) === 'x');
    const yi = items.findIndex((it) => itemKey(it) === 'y');
    const x = xi >= 0 ? int(itemVal(items[xi]!)) : NaN;
    const y = yi >= 0 ? int(itemVal(items[yi]!)) : NaN;
    const pos = Math.abs(x) <= 100000 && Math.abs(y) <= 100000; // NaN → false
    if (pos && attrs.x === undefined) { attrs.x = x; attrs.y = y; }
    items.forEach((raw, i) => {
      const k = itemKey(raw);
      const v = itemVal(raw);
      let ok = false;
      if (k === 'x' || k === 'y') ok = pos && (i === xi || i === yi);
      else if (k === 'color') { const n = int(v); if (inRange(n, 1, 8) && attrs.color === undefined) { attrs.color = n as Color; ok = true; } }
      else if (k === 'w' || k === 'h') { const n = int(v); if (inRange(n, 24, 2000) && attrs[k] === undefined) { attrs[k] = n; ok = true; } }
      else if (k === 'maxw') { const n = int(v); if (inRange(n, 80, 600) && attrs.maxw === undefined) { attrs.maxw = n; ok = true; } }
      else if (k === 'fs') { if ((v === 's' || v === 'm' || v === 'l') && attrs.fs === undefined) { attrs.fs = v; ok = true; } }
      else if (k === 'plegado' && !raw.includes('=')) { attrs.folded = true; ok = true; }
      if (!ok) extra.push(raw.trim());
    });
  }
  return { attrs, extra };
}

export function readEdgeItems(groups: string[][]): { attrs: EdgeAttrs; extra: string[] } {
  const attrs: EdgeAttrs = {};
  const extra: string[] = [];
  for (let g = groups.length - 1; g >= 0; g--) {
    for (const raw of groups[g]!) {
      const k = itemKey(raw);
      const v = itemVal(raw);
      const eq = raw.includes('=');
      let ok = false;
      if (k === 'color') { const n = int(v); if (inRange(n, 1, 8) && attrs.color === undefined) { attrs.color = n as Color; ok = true; } }
      else if (k === 'w') { const n = int(v); if (inRange(n, 1, 8) && attrs.w === undefined) { attrs.w = n; ok = true; } }
      else if (k === 'dash' && !eq) { attrs.dash = true; ok = true; }
      else if (k === 'fin') { if ((ENDS as readonly string[]).includes(v) && attrs.fin === undefined) { attrs.fin = v as EdgeEnd; ok = true; } }
      else if (!eq && (ROUTES as readonly string[]).includes(k) && attrs.route === undefined) { attrs.route = k as Route; ok = true; }
      if (!ok) extra.push(raw.trim());
    }
  }
  return { attrs, extra };
}

// --- Fondo y alto recordados (§P22.1) ---
export function readBackdrop(text: string, fm?: string): Backdrop {
  const f = fm?.trim();
  if (f && (BACKDROPS as readonly string[]).includes(f)) return f as Backdrop;
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
  const m = first ? /^#\s*fondo:\s*(\S+)\s*$/.exec(first) : null;
  return m && (BACKDROPS as readonly string[]).includes(m[1]!) ? (m[1] as Backdrop) : 'cristal';
}

export function readHeight(info?: string, fm?: string): number | undefined {
  const ok = (v?: string) => { const n = v !== undefined && /^\d+$/.test(v.trim()) ? Number(v) : NaN; return inRange(n, 160, 2000) ? n : undefined; };
  return ok(fm) ?? ok(/(?:^|\s)alto=(\S+)/.exec(info ?? '')?.[1]);
}

export interface Tok { shape: Shape; text: string; end: number }

export function readNode(s: string, i: number): Tok | null {
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

export interface Arrow { arrow: DiagramEdge['arrow']; label?: string; end: number }

export function readArrow(s: string, i: number, kind: DiagramKind): Arrow | null {
  const r = s.slice(i);
  if (r.startsWith('-->')) return { arrow: 'to', end: i + 3 };
  if (kind === 'diagrama' && r.startsWith('<-->')) return { arrow: 'both', end: i + 4 };
  if (kind === 'diagrama' && r.startsWith('---')) return { arrow: 'none', end: i + 3 };
  if (!/^--\s/.test(r)) return null;
  // Cierre más cercano (`-->` o `---`), sin regex perezosa (evita el retroceso cúbico con muchos espacios).
  const a = r.indexOf('-->', 3), b = r.indexOf('---', 3);
  const end = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  if (end < 0) return null;
  const to = r.startsWith('-->', end);
  if (!to && kind !== 'diagrama') return null;
  return { arrow: to ? 'to' : 'none', label: r.slice(2, end).trim() || undefined, end: i + end + 3 };
}

export const skipWs = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i]!)) i++; return i; };

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
  type Got = { attrs: NodeAttrs; extra: string[] };
  const NONE: Got = { attrs: {}, extra: [] };
  const merge = (node: DiagramNode, g: Got) => { // primera aparición manda en cada atributo
    const a = g.attrs;
    if (node.x === undefined && a.x !== undefined) { node.x = a.x; node.y = a.y; }
    for (const k of ['color', 'w', 'h', 'maxw', 'fs'] as const) if (node[k] === undefined && a[k] !== undefined) (node as unknown as Record<string, unknown>)[k] = a[k];
    if (a.folded) node.folded = true;
    if (g.extra.length) node.extra = [...(node.extra ?? []), ...g.extra];
  };
  const addNode = (n: Omit<DiagramNode, 'id' | 'line'>, got: Got): DiagramNode => {
    const hit = kind === 'mapa' ? undefined : byKey.get(`${n.shape}\u0000${n.text}`);
    if (hit) { merge(hit, got); return hit; }
    const node: DiagramNode = { ...n, id: `n${doc.nodes.length}`, line: doc.lines.length };
    merge(node, got);
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
        const { rest, groups } = stripSuffixes(body);
        if (!rest) { bad(raw, 'forma'); continue; }
        if (rest.length > MAX_TEXT) { bad(raw, 'tope'); continue; }
        rootSeen = true;
        const n = addNode({ shape: 'rect', text: rest, depth: 0 }, readNodeItems(groups));
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
      const { rest, groups } = stripSuffixes(m[1]!.trim());
      if (!rest) { bad(raw, 'forma'); continue; }
      if (rest.length > MAX_TEXT) { bad(raw, 'tope'); continue; }
      const n = addNode({ shape: 'rect', text: rest, depth, parent: parent.id }, readNodeItems(groups));
      stack.length = depth;
      stack[depth] = n;
      doc.lines.push({ t: 'node', node: n.id, raw });
      continue;
    }

    // flujo y diagrama
    const body = raw.trim();
    let flow: Flow | null = null;
    let cand: Cand | undefined;
    for (const c of suffixCandidates(body)) {
      flow = c.rest ? parseFlowBody(c.rest, kind) : null;
      if (flow) { cand = c; break; }
    }
    if (!flow || !cand) { bad(raw, 'forma'); continue; }
    if (flow.toks.some((t) => t.text.length > MAX_TEXT)) { bad(raw, 'tope'); continue; }

    // Con flechas, x/y/h/maxw/fs/plegado son del último nodo y el resto de la última flecha.
    const hasArrows = flow.arrows.length > 0;
    const nodeG = hasArrows ? cand.groups.map((g) => g.filter((it) => NODE_ONLY.has(itemKey(it)))) : cand.groups;
    const edgeG = hasArrows ? cand.groups.map((g) => g.filter((it) => !NODE_ONLY.has(itemKey(it)))) : [];
    const lineIdx = doc.lines.length;
    const last = flow.toks.length - 1;
    const nodeGot = readNodeItems(nodeG);
    const nodes = flow.toks.map((t, k) => addNode({ shape: t.shape, text: t.text, depth: 0 }, k === last ? nodeGot : NONE));
    if (!hasArrows) { doc.lines.push({ t: 'node', node: nodes[0]!.id, raw }); continue; }
    const edgeGot = readEdgeItems(edgeG);
    const ids: string[] = [];
    flow.arrows.forEach((a, k) => {
      const e: DiagramEdge = {
        id: `e${doc.edges.length}`, from: nodes[k]!.id, to: nodes[k + 1]!.id, arrow: a.arrow, line: lineIdx,
      };
      if (a.label) e.label = a.label;
      if (k === flow.arrows.length - 1) {
        Object.assign(e, edgeGot.attrs);
        if (edgeGot.extra.length) e.extra = edgeGot.extra;
      }
      doc.edges.push(e);
      ids.push(e.id);
    });
    doc.lines.push({ t: 'edge', edges: ids, raw });
  }

  const truncated = doc.nodes.length > MAX_NODES;
  if (truncated) errors.push({ line: doc.nodes[MAX_NODES]!.line, code: 'tope' });
  return { doc, errors, truncated, tooBig: truncated };
}
