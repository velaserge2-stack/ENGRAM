// Ediciones puras del texto de un diagrama (CONTRATO §3). Cada edición reescribe solo las líneas que
// toca (sangría de 2 espacios, un espacio antes de cada sufijo), conserva el resto literal y se
// reanaliza; el inverso es un `splice` de líneas, así que deshacer devuelve el mismo texto.
import { NODE_ONLY, ROUTES, ENDS, itemKey, readArrow, readNode, skipWs, stripSuffixes, suffixCandidates, parseDiagram, type Arrow, type Tok } from './parse';
import {
  BACKDROPS, MAX_LINE, MAX_NODES, MAX_TEXT,
  type Applied, type DiagramDoc, type DiagramKind, type DiagramNode, type Edit, type EdgeAttrs, type NodeAttrs, type Shape, type TreeItem,
} from './types';

const WRAP: Record<Shape, [string, string, string]> = {
  rect: ['[', ']', ']'], round: ['(', ')', ')'], diamond: ['{', '}', '}'], io: ['[/', '/]', ']'], note: ['<<', '>>', '>'],
};
const clean = (t: string) => t.replace(/\s*[\r\n]+\s*/g, ' ').trim();
const key = (shape: Shape, text: string) => `${shape}\u0000${text}`;

// Los enlaces [[nota]] van tal cual; del resto se escapa `\` y el cierre de la forma.
function esc(shape: Shape, text: string): string {
  const c = WRAP[shape][2];
  return text.split(/(\[\[.*?\]\])/).map((p, i) => (i % 2 ? p : p.replace(/\\/g, '\\\\').split(c).join('\\' + c))).join('');
}
const render = (shape: Shape, text: string) => WRAP[shape][0] + esc(shape, text) + WRAP[shape][1];
const mapaLine = (depth: number, text: string) => (depth ? ' '.repeat(2 * (depth - 1)) + '- ' : '') + text;
// Texto + sufijos de una línea de mapa, sin sangría ni viñeta.
const mapaCore = (raw: string, depth: number) => {
  const b = raw.trimEnd().replace(/^[ \t]*/, '');
  return depth ? b.slice(2).trim() : b;
};

// Texto de nodo de mapa: sin saltos, que no se lea como sufijo y la raíz no parezca viñeta o comentario.
function mapaText(text: string, root: boolean): string | null {
  const t = clean(text);
  if (!t || t.length > MAX_TEXT || stripSuffixes(t).rest !== t || (root && /^[-#]/.test(t))) return null;
  return t;
}

// --- Ítems de grupo `{…}`: se edita dentro del grupo original; lo nuevo va al último grupo o a uno nuevo ---
const lookKey = (k: string) => ((ROUTES as readonly string[]).includes(k) ? 'route' : k); // clave lógica
// f: nuevo texto del ítem, null = quitarlo, undefined = dejarlo. `add` = ítems nuevos.
function editItems(tail: string, f: (item: string, key: string) => string | null | undefined, add: string[]): string {
  const gs: { ws: string; items: string[]; hit: boolean }[] = [];
  const re = /(\s*)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) {
    let hit = false;
    const items: string[] = [];
    for (const it of m[2]!.split(',')) {
      const r = f(it, lookKey(itemKey(it)));
      if (r === undefined) items.push(it);
      else { hit = true; if (r !== null) items.push(r); }
    }
    gs.push({ ws: m[1]!, items, hit });
  }
  if (add.length) {
    const last = [...gs].reverse().find((g) => g.items.length);
    if (last) { last.items.push(...add); last.hit = true; } else gs.push({ ws: ' ', items: add, hit: true });
  }
  if (!gs.some((g) => g.hit)) return tail;
  return gs.filter((g) => g.items.length).map((g) => `${g.ws}{${g.items.join(',')}}`).join('');
}
const tailHas = (tail: string, own: (k: string) => boolean, key: string) =>
  [...tail.matchAll(/\{([^{}]*)\}/g)].some((m) => m[1]!.split(',').some((it) => lookKey(itemKey(it)) === key && own(key)));
// Aplica `set` (clave lógica → ítem) y `unset` sobre los ítems que `own` reclama.
function patchTail(tail: string, own: (k: string) => boolean, set: [string, string][], unset: string[]): string {
  const todo = new Map(set);
  const out = editItems(tail, (_, k) => {
    if (!own(k)) return undefined;
    if (todo.has(k)) { const v = todo.get(k)!; todo.delete(k); return v; }
    return set.some(([sk]) => sk === k) || unset.includes(k) ? null : undefined; // repetido o quitado
  }, []);
  const add = set.filter(([k]) => todo.has(k)).map(([, v]) => v);
  return add.length ? editItems(out, () => undefined, add) : out;
}
const nodeTail = (tail: string) => editItems(tail, (_, k) => (NODE_ONLY.has(k) ? undefined : null), []);

// Valida y ordena los atributos a escribir (x,y,color,w,h,maxw,fs,plegado). null = inválido.
const okInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
type Items = { set: [string, string][]; unset: string[] };
function nodeItems(a: NodeAttrs, unset: string[] = []): Items | null {
  const set: [string, string][] = [];
  const un = unset.map((k) => (k === 'folded' ? 'plegado' : k));
  if ((a.x === undefined) !== (a.y === undefined)) return null;
  if (a.x !== undefined) {
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y!)) return null;
    const x = Math.round(a.x), y = Math.round(a.y!);
    if (Math.abs(x) > 100000 || Math.abs(y) > 100000) return null;
    set.push(['x', `x=${x}`], ['y', `y=${y}`]);
  }
  const lim = { color: [1, 8], w: [24, 2000], h: [24, 2000], maxw: [80, 600] } as const;
  for (const k of ['color', 'w', 'h', 'maxw'] as const) {
    if (a[k] === undefined) continue;
    if (!okInt(a[k], lim[k][0], lim[k][1])) return null;
    set.push([k, `${k}=${a[k]}`]);
  }
  if (a.fs !== undefined) { if (!['s', 'm', 'l'].includes(a.fs)) return null; set.push(['fs', `fs=${a.fs}`]); }
  if (a.folded === true) set.push(['plegado', 'plegado']);
  else if (a.folded === false) un.push('plegado');
  if (un.some((k) => !['x', 'y', 'color', 'w', 'h', 'maxw', 'fs', 'plegado'].includes(k))) return null;
  return { set, unset: un };
}
function edgeItems(a: EdgeAttrs, unset: string[] = []): Items | null {
  const set: [string, string][] = [];
  const un = [...unset];
  if (a.color !== undefined) { if (!okInt(a.color, 1, 8)) return null; set.push(['color', `color=${a.color}`]); }
  if (a.w !== undefined) { if (!okInt(a.w, 1, 8)) return null; set.push(['w', `w=${a.w}`]); }
  if (a.dash === true) set.push(['dash', 'dash']); else if (a.dash === false) un.push('dash');
  if (a.fin !== undefined) { if (!ENDS.includes(a.fin)) return null; set.push(['fin', `fin=${a.fin}`]); }
  if (a.route !== undefined) { if (!(ROUTES as readonly string[]).includes(a.route)) return null; set.push(['route', a.route]); }
  if (un.some((k) => !['color', 'w', 'dash', 'fin', 'route'].includes(k))) return null;
  return { set, unset: un };
}

// «Pegar lista» (§P22.2): viñetas -, *, •, 1. 1), sangría relativa (tab = 2 espacios); sin viñetas, una línea por hijo.
export function parseOutline(text: string): TreeItem[] {
  const rows = text.split(/\r\n|\r|\n/).map((l) => l.replace(/\t/g, '  ')).filter((l) => l.trim());
  const bullet = /^(?:[-*•]|\d+[.)])(?:\s+|$)/;
  const any = rows.some((l) => bullet.test(l.trim()));
  const out: TreeItem[] = [];
  const stack: number[] = [];
  for (const l of rows) {
    const body = any ? l.trim().replace(bullet, '').trim() : l.trim();
    if (!body) continue;
    if (!any) { out.push({ text: body, depth: 0 }); continue; }
    const ind = l.length - l.trimStart().length;
    while (stack.length && stack[stack.length - 1]! > ind) stack.pop();
    if (!stack.length || stack[stack.length - 1]! < ind) stack.push(ind);
    out.push({ text: body, depth: stack.length - 1 });
  }
  return out;
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
  for (const c of suffixCandidates(body)) { // misma regla que el parser
    const w = c.rest ? walk(c.rest, kind) : null;
    if (w) return { lead, trail, body, rest: c.rest, tail: c.tail, ...w };
  }
  return null;
}

const solo = (sc: Sc, i: number, j: number, extra = '') => {
  const m = sc.toks.length - 1;
  // un nodo suelto al final de una línea con flechas solo conserva lo que es del nodo
  const tail = j === m ? (j > i || sc.toks.length === 1 ? sc.tail : nodeTail(sc.tail)) : '';
  return sc.lead + sc.body.slice(sc.toks[i]!.s, sc.toks[j]!.e) + tail + extra + sc.trail;
};

// Una edición de varios ids = una por id, en cadena sobre el texto ya cambiado (los ids no se mueven).
function many(doc: DiagramDoc, _e: Edit, ids: string[], one: (id: string) => Edit): string[] | null {
  let cur = doc;
  let L = view(doc);
  for (const id of ids) {
    const next = plan(cur, one(id));
    if (!next) return null;
    L = next;
    cur = parseDiagram(L.join(doc.eol), doc.kind).doc;
  }
  return L;
}

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
      const keepsTail = k === m && (sc.toks.length > 1 ? nodeTail(sc.tail) : sc.tail).trim() !== '';
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
        const it = e.attrs && nodeItems(e.attrs);
        if (e.attrs && !it) return null;
        const g = it && it.set.length ? ` {${it.set.map(([, v]) => v).join(',')}}` : '';
        L.splice(subtreeEnd(doc, ref) + 1, 0, mapaLine(depth, t + g));
        return L;
      }
      const t = clean(e.text);
      if (!t || t.length > MAX_TEXT) return null;
      const tok = render(e.shape ?? 'rect', t);
      const parents = e.op === 'addChild' ? [ref] : [...new Set(doc.edges.filter((d) => d.to === ref.id && d.from !== ref.id && d.arrow === 'to').map((d) => d.from))].map((id) => byId.get(id)!);
      const it = e.attrs && nodeItems(e.attrs);
      if (e.attrs && !it) return null;
      const g = it && it.set.length ? ` {${it.set.map(([, v]) => v).join(',')}}` : '';
      if (!parents.length) append(L, tok + g);
      else {
        for (const p of parents) append(L, `${render(p.shape, p.text)} --> ${tok}`);
        if (g) append(L, tok + g); // color/w en una línea con flechas serían de la flecha
      }
      return L;
    }
    case 'rename': {
      const n = withNode(e.id);
      if (!n) return null;
      if (mapa) {
        const t = mapaText(e.text, n.depth === 0);
        if (!t) return null;
        const core = mapaCore(L[n.line]!, n.depth);
        L[n.line] = mapaLine(n.depth, t + core.slice(stripSuffixes(core).rest.length));
        return L;
      }
      const t = clean(e.text);
      if (!t || t.length > MAX_TEXT) return null;
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
    case 'style':
      return plan(doc, { op: 'edgeAttrs', ids: [e.id], set: { route: e.route } });
    case 'edgeAttrs': {
      const it = edgeItems(e.set ?? {}, (e.unset ?? []) as string[]);
      if (!it || !e.ids.length) return null;
      if (e.ids.length > 1) return many(doc, e, e.ids, (id) => ({ ...e, ids: [id] }));
      const ed = doc.edges.find((x) => x.id === e.ids[0]);
      const line = ed && doc.lines[ed.line];
      if (!ed || !line || line.t !== 'edge') return null;
      const sc = scan(L[ed.line]!, doc.kind);
      const idx = line.edges.indexOf(ed.id);
      if (!sc || idx < 0 || idx >= sc.arrows.length) return null;
      const m = sc.toks.length - 1;
      const own = (k: string) => !NODE_ONLY.has(k);
      if (idx === m - 1) {
        L[ed.line] = sc.lead + sc.rest + patchTail(sc.tail, own, it.set, it.unset) + sc.trail;
      } else { // los atributos solo cuelgan del último tramo: se separa la flecha en su línea
        const mark = patchTail('', own, it.set, it.unset);
        const parts = [solo(sc, idx, idx + 1, mark), solo(sc, idx + 1, m)];
        if (idx > 0) parts.unshift(solo(sc, 0, idx));
        L.splice(ed.line, 1, ...parts);
      }
      return L;
    }
    case 'disconnect':
    case 'label': {
      const ed = doc.edges.find((x) => x.id === e.id);
      const line = ed && doc.lines[ed.line];
      if (!ed || !line || line.t !== 'edge') return null;
      const sc = scan(L[ed.line]!, doc.kind);
      const idx = line.edges.indexOf(ed.id);
      if (!sc || idx < 0 || idx >= sc.arrows.length) return null;
      if (e.op === 'disconnect') {
        const keepE = sc.arrows.map((_, k) => k !== idx);
        L.splice(ed.line, 1, ...rebuild(sc, keepE, sc.toks.map(() => false), new Set([ed.line])));
        return L;
      }
      const l = clean(e.label);
      if (l.length > MAX_TEXT) return null;
      if (l.includes('-->') || l.includes('---') || (ed.arrow === 'both' && l)) return null;
      const arrow = sc.arrows[idx]!;
      const a = ed.arrow === 'both' ? '<-->' : `${l ? `-- ${l} ` : ''}${ed.arrow === 'to' ? '-->' : '---'}`;
      L[ed.line] = sc.lead + sc.body.slice(0, arrow.s) + a + sc.body.slice(arrow.e) + sc.trail;
      return L;
    }
    case 'move':
      if (!(Number.isFinite(e.x) && Number.isFinite(e.y))) return null;
      return plan(doc, { op: 'attrs', ids: [e.id], set: { x: e.x, y: e.y } });
    case 'fold':
      return plan(doc, { op: 'attrs', ids: [e.id], set: { folded: e.folded } });
    case 'attrs': {
      const it = nodeItems(e.set ?? {}, (e.unset ?? []) as string[]);
      if (!it || !e.ids.length) return null;
      if (e.ids.length > 1) return many(doc, e, e.ids, (id) => ({ ...e, ids: [id] }));
      const n = withNode(e.ids[0]!);
      if (!n) return null;
      if (mapa) {
        const core = mapaCore(L[n.line]!, n.depth);
        const rest = stripSuffixes(core).rest;
        L[n.line] = mapaLine(n.depth, rest + patchTail(core.slice(rest.length), () => true, it.set, it.unset));
        return L;
      }
      const lasts = uses(n).filter((u) => matches(u.sc.toks[u.sc.toks.length - 1]!.t, n));
      const accepts = (u: { sc: Sc }, k: string) => u.sc.toks.length === 1 || NODE_ONLY.has(k);
      const ownOf = (u: { sc: Sc }) => (k: string) => accepts(u, k);
      const per = new Map<number, [string, string][]>();
      const loose: [string, string][] = [];
      for (const [k, v] of it.set) {
        const holder = lasts.find((u) => tailHas(u.sc.tail, ownOf(u), k)) ?? lasts.find((u) => accepts(u, k));
        if (!holder) loose.push([k, v]);
        else per.set(holder.i, [...(per.get(holder.i) ?? []), [k, v]]);
      }
      for (const u of lasts) {
        const set = per.get(u.i) ?? [];
        const tail = patchTail(u.sc.tail, ownOf(u), set, it.unset);
        if (tail !== u.sc.tail) L[u.i] = u.sc.lead + u.sc.rest + tail + u.sc.trail;
      }
      if (loose.length) { // sin línea donde escribirlo: línea propia del nodo tras su primer uso
        const first = uses(n)[0]!;
        L.splice(first.i + 1, 0, `${render(n.shape, n.text)} {${loose.map(([, v]) => v).join(',')}}`);
      }
      return L;
    }
    case 'addTree': {
      const p = withNode(e.parent);
      if (!mapa || !p || !e.items.length || doc.nodes.length + e.items.length > MAX_NODES) return null;
      const lines: string[] = [];
      let prev = -1;
      for (const it of e.items) {
        const t = mapaText(it.text, false);
        if (!t || !Number.isInteger(it.depth) || it.depth < 0 || it.depth > prev + 1) return null;
        prev = it.depth;
        lines.push(mapaLine(p.depth + 1 + it.depth, t));
      }
      L.splice(subtreeEnd(doc, p) + 1, 0, ...lines);
      return L;
    }
    case 'backdrop': {
      if (e.value !== undefined && !BACKDROPS.includes(e.value)) return null;
      const want = e.value && e.value !== 'cristal' ? `# fondo: ${e.value}` : null;
      const first = doc.lines.findIndex((l) => l.raw.trim() !== '');
      const has = first >= 0 && /^#\s*fondo:/.test(L[first]!);
      if (want) { if (has) L[first] = want; else if (doc.lines.length) L.unshift(want); else L[0] = want; }
      else if (has) L.splice(first, 1);
      else return null;
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
        return d ? mapaLine(d.depth + delta, mapaCore(raw, d.depth)) : raw;
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
