// Ediciones puras del texto de un diagrama (CONTRATO §3). Cada edición reescribe solo las líneas que
// toca (sangría de 2 espacios, un espacio antes de cada sufijo), conserva el resto literal y se
// reanaliza; el inverso es un `splice` de líneas, así que deshacer devuelve el mismo texto.
import { readArrow, readNode, skipWs, stripSuffixes, parseDiagram, type Arrow, type Tok } from './parse';
import {
  MAX_LINE, MAX_NODES,
  type Applied, type DiagramDoc, type DiagramKind, type DiagramNode, type Edit, type Shape,
} from './types';

const WRAP: Record<Shape, [string, string, string]> = {
  rect: ['[', ']', ']'], round: ['(', ')', ')'], diamond: ['{', '}', '}'], io: ['[/', '/]', ']'], note: ['<<', '>>', '>'],
};
const ROUTE = /\{(recta|curva|orto)\}/;
const POS = /\{x=-?\d+,y=-?\d+\}/;
const FOLD = /\{plegado\}/;

const clean = (t: string) => t.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const key = (shape: Shape, text: string) => `${shape}\u0000${text}`;

// Los enlaces [[nota]] van tal cual; del resto se escapa `\` y el cierre de la forma.
function esc(shape: Shape, text: string): string {
  const c = WRAP[shape][2];
  return text.split(/(\[\[.*?\]\])/).map((p, i) => (i % 2 ? p : p.replace(/\\/g, '\\\\').split(c).join('\\' + c))).join('');
}
const render = (shape: Shape, text: string) => WRAP[shape][0] + esc(shape, text) + WRAP[shape][1];
const sfx = (x?: number, y?: number, folded?: boolean) =>
  (x !== undefined && y !== undefined ? ` {x=${x},y=${y}}` : '') + (folded ? ' {plegado}' : '');
const mapaLine = (depth: number, text: string, x?: number, y?: number, folded?: boolean) =>
  (depth ? ' '.repeat(2 * (depth - 1)) + '- ' : '') + text + sfx(x, y, folded);

// Texto de nodo de mapa: sin saltos, que no se lea como sufijo y la raíz no parezca viñeta o comentario.
function mapaText(text: string, root: boolean): string | null {
  const t = clean(text);
  if (!t || stripSuffixes(t).rest !== t || (root && /^[-#]/.test(t))) return null;
  return t;
}

const view = (doc: DiagramDoc) => (doc.lines.length ? doc.lines.map((l) => l.raw) : ['']);
// Añadir al final, antes de la línea vacía que deja un salto de línea final.
const append = (L: string[], line: string) => { L.splice(L.length > 1 && L[L.length - 1] === '' ? L.length - 1 : L.length, 0, line); };

function subtreeEnd(doc: DiagramDoc, n: DiagramNode): number {
  let end = n.line;
  for (let k = doc.nodes.indexOf(n) + 1; k < doc.nodes.length && doc.nodes[k]!.depth > n.depth; k++) end = doc.nodes[k]!.line;
  return end;
}

// --- Líneas de flujo/diagrama partidas en piezas (para reescribir tokens, flechas y sufijos) ---
interface Sc {
  lead: string; trail: string; body: string; rest: string; tail: string;
  toks: { s: number; e: number; t: Tok }[]; arrows: { s: number; e: number; a: Arrow }[];
}

function walk(s: string, kind: DiagramKind): Pick<Sc, 'toks' | 'arrows'> | null {
  const toks: Sc['toks'] = [];
  const arrows: Sc['arrows'] = [];
  let i = skipWs(s, 0);
  for (;;) {
    const t = readNode(s, i);
    if (!t) return null;
    toks.push({ s: i, e: t.end, t });
    i = skipWs(s, t.end);
    if (i >= s.length) return { toks, arrows };
    const a = readArrow(s, i, kind);
    if (!a) return null;
    arrows.push({ s: i, e: a.end, a });
    i = skipWs(s, a.end);
  }
}

function scan(raw: string, kind: DiagramKind): Sc | null {
  const body = raw.trim();
  if (!body) return null;
  const lead = raw.slice(0, raw.length - raw.trimStart().length);
  const trail = raw.slice(lead.length + body.length);
  const st = stripSuffixes(body);
  const w = st.rest ? walk(st.rest, kind) : null; // misma regla que el parser (`{plegado}` como decisión)
  if (w) return { lead, trail, body, rest: st.rest, tail: body.slice(st.rest.length), ...w };
  const w2 = walk(body, kind);
  return w2 ? { lead, trail, body, rest: body, tail: '', ...w2 } : null;
}

const solo = (sc: Sc, i: number, j: number, extra = '') => {
  const m = sc.toks.length - 1;
  const tail = j === m ? (j > i ? sc.tail : sc.tail.replace(/\s*\{(recta|curva|orto)\}/g, '')) : '';
  return sc.lead + sc.body.slice(sc.toks[i]!.s, sc.toks[j]!.e) + tail + extra + sc.trail;
};

function plan(doc: DiagramDoc, e: Edit): string[] | null {
  const L = view(doc);
  const mapa = doc.kind === 'mapa';
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const byKey = new Map(doc.nodes.map((n) => [key(n.shape, n.text), n]));
  const lineSc = (i: number) => (doc.lines[i]!.t === 'raw' ? null : scan(L[i]!, doc.kind));
  const matches = (t: Tok, n: DiagramNode) => t.shape === n.shape && t.text === n.text;

  // índices de líneas que mencionan al nodo (con su partición)
  const uses = (n: DiagramNode) => {
    const r: { i: number; sc: Sc }[] = [];
    L.forEach((_, i) => { const sc = lineSc(i); if (sc && sc.toks.some((k) => matches(k.t, n))) r.push({ i, sc }); });
    return r;
  };
  const refs = (n: DiagramNode) => {
    const s = new Set<number>();
    doc.lines.forEach((l, i) => {
      if (l.t === 'node' && l.node === n.id) s.add(i);
      if (l.t === 'edge' && l.edges.some((id) => { const ed = doc.edges.find((x) => x.id === id); return ed && (ed.from === n.id || ed.to === n.id); })) s.add(i);
    });
    return s;
  };

  // Reescribe una línea de flujo: `keepE[k]` conserva la flecha k, `gone[k]` quita el token k.
  const rebuild = (sc: Sc, keepE: boolean[], gone: boolean[], rewritten: Set<number>): string[] => {
    const m = sc.toks.length - 1;
    const out: string[] = [];
    for (let k = 0; k <= m;) {
      if (gone[k]) { k++; continue; }
      let j = k;
      while (j < m && keepE[j]) j++;
      if (j > k) { out.push(solo(sc, k, j)); k = j + 1; continue; }
      const n = byKey.get(key(sc.toks[k]!.t.shape, sc.toks[k]!.t.text));
      const elsewhere = n && [...refs(n)].some((r) => !rewritten.has(r));
      const keepsTail = k === m && /\{(x=|plegado)/.test(sc.tail);
      if (!elsewhere || keepsTail) out.push(solo(sc, k, k));
      k++;
    }
    return out;
  };

  const withNode = (id: string) => byId.get(id);

  switch (e.op) {
    case 'splice': {
      if (!Number.isInteger(e.at) || !Number.isInteger(e.remove) || e.at < 0 || e.remove < 0 || e.at + e.remove > L.length) return null;
      L.splice(e.at, e.remove, ...e.insert);
      return L;
    }
    case 'addChild':
    case 'addSibling': {
      const ref = withNode(e.op === 'addChild' ? e.parent : e.id);
      if (!ref) return null;
      if (mapa) {
        const t = mapaText(e.text, false);
        if (!t || (e.op === 'addSibling' && ref.depth === 0)) return null;
        const depth = e.op === 'addChild' ? ref.depth + 1 : ref.depth;
        L.splice(subtreeEnd(doc, ref) + 1, 0, mapaLine(depth, t));
        return L;
      }
      const t = clean(e.text);
      if (!t) return null;
      const tok = render(e.shape ?? 'rect', t);
      const parents = e.op === 'addChild' ? [ref] : [...new Set(doc.edges.filter((d) => d.to === ref.id && d.from !== ref.id && d.arrow === 'to').map((d) => d.from))].map((id) => byId.get(id)!);
      if (!parents.length) append(L, tok);
      for (const p of parents) append(L, `${render(p.shape, p.text)} --> ${tok}`);
      return L;
    }
    case 'rename': {
      const n = withNode(e.id);
      if (!n) return null;
      if (mapa) {
        const t = mapaText(e.text, n.depth === 0);
        if (!t) return null;
        L[n.line] = mapaLine(n.depth, t, n.x, n.y, n.folded);
        return L;
      }
      const t = clean(e.text);
      if (!t) return null;
      const tok = render(n.shape, t);
      for (const { i, sc } of uses(n)) {
        let body = sc.body;
        for (const k of [...sc.toks].reverse()) if (matches(k.t, n)) body = body.slice(0, k.s) + tok + body.slice(k.e);
        L[i] = sc.lead + body + sc.trail;
      }
      return L;
    }
    case 'remove': {
      const n = withNode(e.id);
      if (!n) return null;
      if (mapa) { L.splice(n.line, subtreeEnd(doc, n) - n.line + 1); return L; }
      const us = uses(n);
      const rewritten = new Set(us.map((u) => u.i));
      const out = new Map(us.map(({ i, sc }) => {
        const gone = sc.toks.map((k) => matches(k.t, n));
        const keepE = sc.arrows.map((_, k) => !gone[k] && !gone[k + 1]);
        return [i, rebuild(sc, keepE, gone, rewritten)];
      }));
      return L.flatMap((l, i) => out.get(i) ?? [l]);
    }
    case 'connect': {
      const f = withNode(e.from);
      const t = withNode(e.to);
      const arrow = e.arrow ?? 'to';
      if (mapa || !f || !t || (arrow !== 'to' && doc.kind !== 'diagrama') || (e.route && !['recta', 'curva', 'orto'].includes(e.route))) return null;
      const a = arrow === 'to' ? '-->' : arrow === 'none' ? '---' : '<-->';
      append(L, `${render(f.shape, f.text)} ${a} ${render(t.shape, t.text)}${e.route ? ` {${e.route}}` : ''}`);
      return L;
    }
    case 'disconnect':
    case 'style':
    case 'label': {
      const ed = doc.edges.find((x) => x.id === e.id);
      const line = ed && doc.lines[ed.line];
      if (!ed || !line || line.t !== 'edge') return null;
      const sc = scan(L[ed.line]!, doc.kind);
      const idx = line.edges.indexOf(ed.id);
      if (!sc || idx < 0 || idx >= sc.arrows.length) return null;
      const m = sc.toks.length - 1;
      if (e.op === 'disconnect') {
        const keepE = sc.arrows.map((_, k) => k !== idx);
        L.splice(ed.line, 1, ...rebuild(sc, keepE, sc.toks.map(() => false), new Set([ed.line])));
        return L;
      }
      if (e.op === 'style') {
        if (!['recta', 'curva', 'orto'].includes(e.route)) return null;
        const mark = ` {${e.route}}`;
        if (idx === m - 1) {
          const tail = ROUTE.test(sc.tail) ? sc.tail.replace(ROUTE, `{${e.route}}`) : sc.tail + mark;
          L[ed.line] = sc.lead + sc.rest + tail + sc.trail;
        } else { // la ortogonal/recta solo cuelga del último tramo: se separa la flecha en su línea
          const parts = [solo(sc, idx, idx + 1, mark), solo(sc, idx + 1, m)];
          if (idx > 0) parts.unshift(solo(sc, 0, idx));
          L.splice(ed.line, 1, ...parts);
        }
        return L;
      }
      const l = clean(e.label);
      if (l.includes('-->') || l.includes('---') || (ed.arrow === 'both' && l)) return null;
      const arrow = sc.arrows[idx]!;
      const a = ed.arrow === 'both' ? '<-->' : `${l ? `-- ${l} ` : ''}${ed.arrow === 'to' ? '-->' : '---'}`;
      L[ed.line] = sc.lead + sc.body.slice(0, arrow.s) + a + sc.body.slice(arrow.e) + sc.trail;
      return L;
    }
    case 'move':
    case 'fold': {
      const n = withNode(e.id);
      if (!n) return null;
      if (e.op === 'move' && !(Number.isFinite(e.x) && Number.isFinite(e.y))) return null;
      const x = e.op === 'move' ? Math.round(e.x) : 0;
      const y = e.op === 'move' ? Math.round(e.y) : 0;
      if (mapa) {
        L[n.line] = e.op === 'move' ? mapaLine(n.depth, n.text, x, y, n.folded) : mapaLine(n.depth, n.text, n.x, n.y, e.folded);
        return L;
      }
      const us = uses(n);
      const lasts = us.filter((u) => matches(u.sc.toks[u.sc.toks.length - 1]!.t, n));
      const set = (u: { i: number; sc: Sc }, tail: string) => { L[u.i] = u.sc.lead + u.sc.rest + tail + u.sc.trail; };
      if (e.op === 'fold' && !e.folded) {
        for (const u of lasts) set(u, u.sc.tail.replace(/\s*\{plegado\}/g, ''));
        return L;
      }
      const re = e.op === 'move' ? POS : FOLD;
      const mark = e.op === 'move' ? `{x=${x},y=${y}}` : '{plegado}';
      const has = lasts.find((u) => re.test(u.sc.tail));
      if (has) { set(has, has.sc.tail.replace(re, mark)); return L; }
      if (lasts[0]) set(lasts[0], `${lasts[0].sc.tail} ${mark}`);
      else if (us[0]) L.splice(us[0].i + 1, 0, `${render(n.shape, n.text)} ${mark}`);
      return L;
    }
    case 'reparent': {
      const n = withNode(e.id);
      const p = withNode(e.parent);
      if (!mapa || !n || !p || n.depth === 0 || p === n) return null;
      const s = n.line;
      const end = subtreeEnd(doc, n);
      if (p.line >= s && p.line <= end) return null; // el padre nuevo es descendiente
      const delta = p.depth + 1 - n.depth;
      const moved = L.slice(s, end + 1).map((raw, k) => {
        const ln = doc.lines[s + k]!;
        const d = ln.t === 'node' ? byId.get(ln.node) : undefined;
        return d ? mapaLine(d.depth + delta, d.text, d.x, d.y, d.folded) : raw;
      });
      let at = subtreeEnd(doc, p) + 1;
      L.splice(s, end - s + 1);
      if (at > end) at -= end - s + 1;
      L.splice(at, 0, ...moved);
      return L;
    }
  }
}

// Aplica la edición y devuelve el documento nuevo y su inverso (un `splice`). Inválida o sin efecto: no-op.
export function applyEdit(doc: DiagramDoc, edit: Edit): Applied {
  const none: Applied = { doc, inverse: [] };
  const L = plan(doc, edit);
  if (!L) return none;
  const old = view(doc);
  let p = 0;
  while (p < old.length && p < L.length && old[p] === L[p]) p++;
  let s = 0;
  while (s < old.length - p && s < L.length - p && old[old.length - 1 - s] === L[L.length - 1 - s]) s++;
  if (p === old.length && p === L.length) return none;
  const ins = L.slice(p, L.length - s);
  if (ins.some((l) => l.length > MAX_LINE)) return none;
  const next = parseDiagram(L.join(doc.eol), doc.kind).doc;
  if (next.nodes.length > MAX_NODES && next.nodes.length > doc.nodes.length) return none;
  return { doc: next, inverse: [{ op: 'splice', at: p, remove: ins.length, insert: old.slice(p, old.length - s) }] };
}
