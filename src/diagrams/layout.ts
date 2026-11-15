// Acomodo automático de diagramas (CONTRATO §3). Funciones puras: sin DOM, sin estado, sin azar ni fecha.
// Convención: `pos` guarda el CENTRO de cada nodo (x, y) y su tamaño (w, h); la raíz del mapa queda en 0,0.
// `paths` va por id de arista (flujo/diagrama) o por id del nodo hijo (mapa: conector padre → hijo).
import type { DiagramDoc, DiagramEdge, DiagramNode, Dir, Layout } from './types';

/** Tamaños medidos por id (measure.ts). Si falta un id se usa `nodeSize`. */
export type SizeMap = Map<string, { w: number; h: number }>;

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
type Ori = 'v' | 'h';

const LAYER_GAP = 56; // entre capas (eje principal)
const NODE_GAP = 40; // entre nodos de una capa (eje transversal)
const DUMMY_GAP = 16; // con nodos virtuales de aristas largas
const COMP_GAP = 80; // entre componentes desconectados
const MAX_PASSES = 4; // barridos de baricentro (bajada + subida) para cruces
const COORD_PASSES = 4; // pasadas de alineación de coordenadas
const DUMMY_SIZE = 8;

/** Tamaño estimado de un nodo por su texto (sin marcas `**`, `*`, `[[ ]]`), recortado a 200 caracteres. */
export function nodeSize(n: Pick<DiagramNode, 'shape' | 'text'>): { w: number; h: number } {
  const len = Math.min(200, n.text.replace(/\*\*|\*|\[\[|\]\]/g, '').length);
  const w0 = Math.min(220, Math.max(64, len * 7 + 24));
  const lines = Math.max(1, Math.ceil((len * 7) / (w0 - 24)));
  let w = w0, h = Math.max(36, 16 + lines * 20);
  if (n.shape === 'diamond') { w = Math.round(w * 1.4); h = Math.round(h * 1.4); }
  else if (n.shape === 'io') w += 16;
  return { w, h };
}

const r = (n: number) => Math.round(n);
const pt = (p: Pt) => `${r(p.x)} ${r(p.y)}`;
const hasPos = (n: DiagramNode) => typeof n.x === 'number' && typeof n.y === 'number' && Number.isFinite(n.x) && Number.isFinite(n.y);

/** Lado del rectángulo por el que sale/entra una arista hacia `t`: arriba/abajo ('v') o izquierda/derecha ('h'). */
function anchor(b: Box, t: Pt, tb: boolean): { p: Pt; ori: Ori } {
  const dx = t.x - b.x, dy = t.y - b.y;
  const ori: Ori = tb ? (Math.abs(dy) > b.h / 2 ? 'v' : 'h') : (Math.abs(dx) > b.w / 2 ? 'h' : 'v');
  return ori === 'v'
    ? { p: { x: b.x, y: b.y + (dy < 0 ? -1 : 1) * b.h / 2 }, ori }
    : { p: { x: b.x + (dx < 0 ? -1 : 1) * b.w / 2, y: b.y }, ori };
}

/** `d` de SVG por una lista de puntos. curva: Bézier cúbicas; orto: codos; recta: polilínea. */
function pathD(ps: Pt[], startOri: Ori, endOri: Ori, mainOri: Ori, route: DiagramEdge['route']): string {
  const p0 = ps[0]!;
  let d = `M ${pt(p0)}`;
  if (route === 'recta') { for (let i = 1; i < ps.length; i++) d += ` L ${pt(ps[i]!)}`; return d; }
  const last = ps.length - 2;
  for (let i = 0; i <= last; i++) {
    const p = ps[i]!, q = ps[i + 1]!;
    const o1 = i === 0 ? startOri : mainOri, o2 = i === last ? endOri : mainOri;
    if (route === 'orto') {
      if (o1 === 'v') { const my = (p.y + q.y) / 2; d += ` L ${pt({ x: p.x, y: my })} L ${pt({ x: q.x, y: my })} L ${pt(q)}`; }
      else { const mx = (p.x + q.x) / 2; d += ` L ${pt({ x: mx, y: p.y })} L ${pt({ x: mx, y: q.y })} L ${pt(q)}`; }
    } else {
      const c1 = o1 === 'v' ? { x: p.x, y: (p.y + q.y) / 2 } : { x: (p.x + q.x) / 2, y: p.y };
      const c2 = o2 === 'v' ? { x: q.x, y: (p.y + q.y) / 2 } : { x: (p.x + q.x) / 2, y: q.y };
      d += ` C ${pt(c1)} ${pt(c2)} ${pt(q)}`;
    }
  }
  return d;
}

class Bounds {
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  box(b: Box) { this.pt(b.x - b.w / 2, b.y - b.h / 2); this.pt(b.x + b.w / 2, b.y + b.h / 2); }
  pt(x: number, y: number) { if (x < this.x0) this.x0 = x; if (y < this.y0) this.y0 = y; if (x > this.x1) this.x1 = x; if (y > this.y1) this.y1 = y; }
  get() { return this.x0 > this.x1 ? { x: 0, y: 0, w: 0, h: 0 } : { x: r(this.x0), y: r(this.y0), w: r(this.x1 - this.x0), h: r(this.y1 - this.y0) }; }
}

/** Cruces entre dos filas consecutivas: inversiones de las posiciones de abajo con las aristas ordenadas por arriba. */
function crossingsBetween(row: number[], down: number[][], pos: Int32Array, size: number): number {
  const segs: number[] = [];
  for (const u of row) {
    const ls = down[u]!.map(v => pos[v]!).sort((a, b) => a - b);
    for (const l of ls) segs.push(l);
  }
  // Árbol de Fenwick: por cada segmento, cuántos anteriores tienen posición inferior mayor.
  const bit = new Int32Array(size + 1);
  let c = 0, seen = 0;
  for (const l of segs) {
    let s = 0; for (let i = l + 1; i > 0; i -= i & -i) s += bit[i]!;
    c += seen - s; seen++;
    for (let i = l + 1; i <= size; i += i & -i) bit[i]!++;
  }
  return c;
}

/**
 * Acomodo por capas (Sugiyama simplificado) para `flujo` y `diagrama`.
 * 1. Ciclos: DFS en orden del texto; las aristas de retroceso se invierten solo para calcular capas.
 * 2. Capas por camino más largo (Kahn). Aristas que saltan capas → nodos virtuales (puntos de paso).
 * 3. Cruces: baricentro, a lo sumo MAX_PASSES pasadas (bajada + subida); se queda el mejor orden visto.
 * 4. Coordenadas: filas empacadas y alineadas hacia el promedio de vecinos, sin solaparse ni cambiar el orden.
 * Componentes lado a lado; nodos sin aristas en una franja aparte; `x/y` manuales mandan.
 */
export function layoutLayered(doc: DiagramDoc, dir: Dir | 'tb' | 'lr', sizes?: SizeMap): Layout {
  const tb = dir === 'TB' || dir === 'tb';
  const nodes = doc.nodes, N = nodes.length;
  const idx = new Map<string, number>();
  nodes.forEach((n, i) => { if (!idx.has(n.id)) idx.set(n.id, i); });
  const size = nodes.map(n => sizes?.get(n.id) ?? nodeSize(n));

  // Aristas válidas (extremos existentes).
  const es: { e: DiagramEdge; u: number; v: number }[] = [];
  for (const e of doc.edges) {
    const u = idx.get(e.from), v = idx.get(e.to);
    if (u !== undefined && v !== undefined) es.push({ e, u, v });
  }
  const hasEdge = new Uint8Array(N);
  const out: number[][] = Array.from({ length: N }, () => []); // índices de `es`
  for (let k = 0; k < es.length; k++) {
    const { u, v } = es[k]!;
    hasEdge[u] = 1; hasEdge[v] = 1;
    if (u !== v) out[u]!.push(k);
  }

  // 1. Romper ciclos (DFS iterativo, determinista).
  const reversed = new Uint8Array(es.length);
  const state = new Uint8Array(N); // 0 nuevo, 1 en pila, 2 hecho
  for (let s = 0; s < N; s++) {
    if (state[s] || !hasEdge[s]) continue;
    const stack: [number, number][] = [[s, 0]]; state[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const [u, i] = top;
      if (i >= out[u]!.length) { state[u] = 2; stack.pop(); continue; }
      top[1]++;
      const k = out[u]![i]!, v = es[k]!.v;
      if (state[v] === 1) reversed[k] = 1;
      else if (state[v] === 0) { state[v] = 1; stack.push([v, 0]); }
    }
  }

  // 2. Capas por camino más largo sobre el grafo acíclico.
  const dag: [number, number, number][] = []; // [a, b, k]
  const indeg = new Int32Array(N);
  const dOut: number[][] = Array.from({ length: N }, () => []);
  for (let k = 0; k < es.length; k++) {
    const { u, v } = es[k]!;
    if (u === v) continue;
    const a = reversed[k] ? v : u, b = reversed[k] ? u : v;
    dag.push([a, b, k]); dOut[a]!.push(dag.length - 1); indeg[b] = indeg[b]! + 1;
  }
  const layer = new Int32Array(N);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) if (indeg[i] === 0) queue.push(i);
  for (let h = 0; h < queue.length; h++) {
    const a = queue[h]!;
    for (const j of dOut[a]!) {
      const b = dag[j]![1];
      if (layer[a]! + 1 > layer[b]!) layer[b] = layer[a]! + 1;
      indeg[b] = indeg[b]! - 1; if (indeg[b] === 0) queue.push(b);
    }
  }

  // Componentes (unión-búsqueda) en orden del primer nodo.
  const parent = Int32Array.from({ length: N }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; };
  for (const { u, v } of es) { const a = find(u), b = find(v); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  const comps = new Map<number, number[]>();
  const isolated: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!hasEdge[i]) { isolated.push(i); continue; }
    const c = find(i);
    let list = comps.get(c); if (!list) comps.set(c, list = []); list.push(i);
  }

  // Vértices: reales 0..N-1 y virtuales N.. (puntos de paso de aristas largas).
  const vLayer: number[] = Array.from(layer);
  const cs: number[] = size.map(s => (tb ? s.w : s.h)); // tamaño transversal
  const ms: number[] = size.map(s => (tb ? s.h : s.w)); // tamaño principal
  const vc: number[] = new Array<number>(N).fill(0); // coordenada transversal
  const vm: number[] = new Array<number>(N).fill(0); // coordenada principal
  const chains = new Map<number, number[]>(); // k de `es` → vértices en sentido de capas
  const up: number[][] = Array.from({ length: N }, () => []);
  const down: number[][] = Array.from({ length: N }, () => []);
  const addV = (l: number) => { vLayer.push(l); cs.push(DUMMY_SIZE); ms.push(0); vc.push(0); vm.push(0); up.push([]); down.push([]); return vLayer.length - 1; };

  let crossCursor = 0, mainMax = 0;
  for (const members of comps.values()) {
    const verts = members.slice();
    let L = 0;
    for (const i of members) if (layer[i]! + 1 > L) L = layer[i]! + 1;
    for (const [a, b, k] of dag) {
      if (find(a) !== find(members[0]!)) continue;
      const chain = [a];
      for (let l = layer[a]! + 1; l < layer[b]!; l++) { const d = addV(l); verts.push(d); chain.push(d); }
      chain.push(b);
      for (let j = 0; j + 1 < chain.length; j++) { down[chain[j]!]!.push(chain[j + 1]!); up[chain[j + 1]!]!.push(chain[j]!); }
      chains.set(k, chain);
    }
    // Filas: orden inicial = orden del texto (virtuales al final, en orden de creación).
    const rows: number[][] = Array.from({ length: L }, () => []);
    for (const v of verts) rows[vLayer[v]!]!.push(v);
    const pos = new Int32Array(vLayer.length);
    const setPos = () => { for (const row of rows) row.forEach((v, j) => { pos[v] = j; }); };
    setPos();
    const total = () => { let c = 0; for (let l = 0; l + 1 < L; l++) c += crossingsBetween(rows[l]!, down, pos, rows[l + 1]!.length); return c; };
    let best = rows.map(x => x.slice()), bestC = total();
    const sortRow = (l: number, nb: number[][]) => {
      const row = rows[l]!;
      const key = new Map<number, number>();
      for (const v of row) { const ns = nb[v]!; key.set(v, ns.length ? ns.reduce((s, w) => s + pos[w]!, 0) / ns.length : pos[v]!); }
      row.sort((a, b) => key.get(a)! - key.get(b)! || pos[a]! - pos[b]!);
      row.forEach((v, j) => { pos[v] = j; });
    };
    // 3. Barrido de baricentro acotado.
    for (let it = 0; it < MAX_PASSES && bestC > 0; it++) {
      for (let l = 1; l < L; l++) sortRow(l, up);
      for (let l = L - 2; l >= 0; l--) sortRow(l, down);
      const c = total();
      if (c < bestC) { bestC = c; best = rows.map(x => x.slice()); }
    }
    for (let l = 0; l < L; l++) rows[l] = best[l]!;
    setPos();

    // 4. Coordenadas transversales.
    const sep = (a: number, b: number) => (cs[a]! + cs[b]!) / 2 + (a >= N || b >= N ? DUMMY_GAP : NODE_GAP);
    for (const row of rows) {
      let x = 0; row.forEach((v, j) => { if (j) x += sep(row[j - 1]!, v); vc[v] = x; });
      const mid = x / 2; for (const v of row) vc[v]! -= mid;
    }
    const place = (row: number[], nb: number[][]) => {
      const n = row.length; if (!n) return;
      const want = row.map(v => { const ns = nb[v]!; return ns.length ? ns.reduce((s, w) => s + vc[w]!, 0) / ns.length : vc[v]!; });
      const a = want.slice(), b = want.slice();
      for (let j = 1; j < n; j++) a[j] = Math.max(a[j]!, a[j - 1]! + sep(row[j - 1]!, row[j]!));
      for (let j = n - 2; j >= 0; j--) b[j] = Math.min(b[j]!, b[j + 1]! - sep(row[j]!, row[j + 1]!));
      let prev = -Infinity;
      row.forEach((v, j) => { const c = Math.max((a[j]! + b[j]!) / 2, j ? prev + sep(row[j - 1]!, v) : -Infinity); vc[v] = c; prev = c; });
    };
    for (let p = 0; p < COORD_PASSES; p++) {
      if (p % 2 === 0) for (let l = 1; l < L; l++) place(rows[l]!, up);
      else for (let l = L - 2; l >= 0; l--) place(rows[l]!, down);
    }
    // Eje principal: centro de cada capa según su nodo más grueso.
    let m = 0;
    for (let l = 0; l < L; l++) {
      const th = rows[l]!.reduce((t, v) => Math.max(t, ms[v]!), 0);
      if (l) m += LAYER_GAP;
      for (const v of rows[l]!) vm[v] = m + th / 2;
      m += th;
    }
    mainMax = Math.max(mainMax, m);
    // Normaliza la franja del componente y la coloca tras la anterior.
    let lo = Infinity, hi = -Infinity;
    for (const v of verts) { lo = Math.min(lo, vc[v]! - cs[v]! / 2); hi = Math.max(hi, vc[v]! + cs[v]! / 2); }
    for (const v of verts) vc[v] = vc[v]! - lo + crossCursor;
    crossCursor += hi - lo + COMP_GAP;
  }

  // Nodos sin aristas: franja aparte tras los componentes, en filas que se envuelven.
  if (isolated.length) {
    const wrap = Math.max(crossCursor - COMP_GAP, 640);
    let c = 0, m = comps.size ? mainMax + LAYER_GAP * 1.5 : 0, th = 0;
    for (const i of isolated) {
      if (c > 0 && c + cs[i]! > wrap) { c = 0; m += th + NODE_GAP; th = 0; }
      vc[i] = c + cs[i]! / 2; vm[i] = m + ms[i]! / 2;
      c += cs[i]! + NODE_GAP; th = Math.max(th, ms[i]!);
    }
  }

  const P = (v: number): Pt => (tb ? { x: vc[v]!, y: vm[v]! } : { x: vm[v]!, y: vc[v]! });
  const pos: Layout['pos'] = new Map();
  const bounds = new Bounds();
  const manual = new Uint8Array(N);
  const boxes: Box[] = nodes.map((n, i) => {
    const s = size[i]!;
    const c = hasPos(n) ? (manual[i] = 1, { x: n.x!, y: n.y! }) : P(i);
    return { x: r(c.x), y: r(c.y), w: s.w, h: s.h };
  });
  nodes.forEach((n, i) => { if (!pos.has(n.id)) { pos.set(n.id, boxes[i]!); bounds.box(boxes[i]!); } });

  // Trazado: la flecha conserva su dirección real (las invertidas recorren su cadena al revés).
  const paths: Layout['paths'] = new Map();
  const mainOri: Ori = tb ? 'v' : 'h';
  for (let k = 0; k < es.length; k++) {
    const { e, u, v } = es[k]!;
    const bu = boxes[u]!, bv = boxes[v]!;
    if (u === v) {
      const a = tb ? { x: bu.x + bu.w / 2, y: bu.y - bu.h / 4 } : { x: bu.x - bu.w / 4, y: bu.y + bu.h / 2 };
      const b = tb ? { x: bu.x + bu.w / 2, y: bu.y + bu.h / 4 } : { x: bu.x + bu.w / 4, y: bu.y + bu.h / 2 };
      const c1 = tb ? { x: a.x + 36, y: a.y - 24 } : { x: a.x - 24, y: a.y + 36 };
      const c2 = tb ? { x: b.x + 36, y: b.y + 24 } : { x: b.x + 24, y: b.y + 36 };
      bounds.pt(c1.x, c1.y); bounds.pt(c2.x, c2.y);
      paths.set(e.id, `M ${pt(a)} C ${pt(c1)} ${pt(c2)} ${pt(b)}`);
      continue;
    }
    let mid: Pt[] = [];
    const chain = chains.get(k);
    if (chain && !manual[u] && !manual[v]) {
      mid = chain.slice(1, -1).map(P);
      if (reversed[k]) mid.reverse();
    }
    const s = anchor(bu, mid[0] ?? bv, tb), t = anchor(bv, mid[mid.length - 1] ?? bu, tb);
    const ps = [s.p, ...mid, t.p];
    for (const p of ps) bounds.pt(p.x, p.y);
    paths.set(e.id, pathD(ps, s.ori, t.ori, mainOri, e.route ?? 'curva'));
  }
  return { pos, paths, bounds: bounds.get() };
}

const H_GAP = 48, V_GAP = 12, TREE_GAP = 40, RADIAL_SPACING = 56;

/**
 * Acomodo de árbol para `mapa`. horizontal: raíz a la izquierda y columnas por nivel; radial: anillos por nivel.
 * Ramas plegadas = sin hijos (los descendientes no reciben posición). `x/y` manuales son relativos a la raíz
 * (en 0,0) y arrastran a sus descendientes sin posición propia. Varias raíces (texto anómalo): árboles en fila.
 */
export function layoutTree(doc: DiagramDoc, mode: 'horizontal' | 'radial' = 'horizontal', sizes?: SizeMap): Layout {
  const nodes = doc.nodes, N = nodes.length;
  const idx = new Map<string, number>();
  nodes.forEach((n, i) => { if (!idx.has(n.id)) idx.set(n.id, i); });
  const size = nodes.map(n => sizes?.get(n.id) ?? nodeSize(n));
  const kids: number[][] = Array.from({ length: N }, () => []);
  const roots: number[] = [];
  nodes.forEach((n, i) => {
    const p = n.parent === undefined ? undefined : idx.get(n.parent);
    if (p === undefined || p === i) roots.push(i); else kids[p]!.push(i);
  });

  // Recorrido en preorden (iterativo, a prueba de ciclos en `parent`), solo ramas visibles.
  const seen = new Uint8Array(N);
  const vis: number[] = [], depth = new Int32Array(N), par = new Int32Array(N).fill(-1);
  const treeOf: number[][] = [];
  const walk = (root: number) => {
    const order: number[] = [];
    const st = [root]; seen[root] = 1;
    while (st.length) {
      const u = st.pop()!; order.push(u); vis.push(u);
      if (nodes[u]!.folded) continue;
      const ks = kids[u]!;
      for (let j = ks.length - 1; j >= 0; j--) { const c = ks[j]!; if (!seen[c]) { seen[c] = 1; depth[c] = depth[u]! + 1; par[c] = u; st.push(c); } }
    }
    treeOf.push(order);
  };
  for (const rt of roots) if (!seen[rt]) walk(rt);
  // No vistos: bajo una rama plegada (ocultos) o en un ciclo de `parent` (se vuelven raíz).
  for (let i = 0; i < N; i++) {
    if (seen[i]) continue;
    let p = nodes[i]!.parent === undefined ? undefined : idx.get(nodes[i]!.parent!);
    let steps = 0, underFold = false;
    while (p !== undefined && steps++ <= N) { if (nodes[p]!.folded) { underFold = true; break; } const q = nodes[p]!.parent; p = q === undefined ? undefined : idx.get(q); }
    if (!underFold) walk(i);
  }

  const cx = new Float64Array(N), cy = new Float64Array(N);
  const B = new Bounds();
  let cursor = 0;
  for (const order of treeOf) {
    const root = order[0]!;
    if (mode === 'radial') {
      const leaves = new Float64Array(N);
      for (let j = order.length - 1; j >= 0; j--) { const u = order[j]!; if (!leaves[u]) leaves[u] = 1; if (u !== root) leaves[par[u]!] = leaves[par[u]!]! + leaves[u]!; }
      let maxDim = 0; const perDepth = new Map<number, number>();
      for (const u of order) { maxDim = Math.max(maxDim, size[u]!.w, size[u]!.h); const d = depth[u]! - depth[root]!; perDepth.set(d, (perDepth.get(d) ?? 0) + 1); }
      let R = maxDim + 40;
      for (const [d, n] of perDepth) if (d > 0) R = Math.max(R, (n * RADIAL_SPACING) / (2 * Math.PI * d));
      const a0 = new Float64Array(N), a1 = new Float64Array(N);
      a0[root] = -Math.PI / 2; a1[root] = (3 * Math.PI) / 2;
      for (const u of order) {
        const d = depth[u]! - depth[root]!;
        const th = (a0[u]! + a1[u]!) / 2;
        cx[u] = d ? R * d * Math.cos(th) : 0; cy[u] = d ? R * d * Math.sin(th) : 0;
        let a = a0[u]!;
        const span = a1[u]! - a0[u]!, tot = leaves[u]!;
        for (const c of kids[u]!) { if (par[c] !== u) continue; const w = (span * leaves[c]!) / tot; a0[c] = a; a1[c] = a + w; a += w; }
      }
    } else {
      // Columnas por nivel (borde izquierdo alineado) y altura de subárbol.
      const colW: number[] = [];
      for (const u of order) { const d = depth[u]! - depth[root]!; colW[d] = Math.max(colW[d] ?? 0, size[u]!.w); }
      const left: number[] = [-size[root]!.w / 2];
      for (let d = 1; d < colW.length; d++) left[d] = left[d - 1]! + colW[d - 1]! + H_GAP;
      const ext = new Float64Array(N);
      for (let j = order.length - 1; j >= 0; j--) {
        const u = order[j]!;
        let s = 0, n = 0;
        for (const c of kids[u]!) if (par[c] === u) { s += ext[c]!; n++; }
        ext[u] = Math.max(size[u]!.h, s + V_GAP * Math.max(0, n - 1));
      }
      const top = new Float64Array(N);
      top[root] = -ext[root]! / 2;
      for (const u of order) {
        const d = depth[u]! - depth[root]!;
        cx[u] = left[d]! + size[u]!.w / 2; cy[u] = top[u]! + ext[u]! / 2;
        let s = 0, n = 0;
        for (const c of kids[u]!) if (par[c] === u) { s += ext[c]!; n++; }
        let y = top[u]! + (ext[u]! - (s + V_GAP * Math.max(0, n - 1))) / 2;
        for (const c of kids[u]!) if (par[c] === u) { top[c] = y; y += ext[c]! + V_GAP; }
      }
    }
    // Árboles adicionales: debajo (horizontal) o a la derecha (radial) del anterior.
    if (order !== treeOf[0]) {
      let lo = Infinity;
      for (const u of order) lo = Math.min(lo, mode === 'radial' ? cx[u]! - size[u]!.w / 2 : cy[u]! - size[u]!.h / 2);
      for (const u of order) { if (mode === 'radial') cx[u] = cx[u]! - lo + cursor; else cy[u] = cy[u]! - lo + cursor; }
    }
    for (const u of order) cursor = Math.max(cursor, mode === 'radial' ? cx[u]! + size[u]!.w / 2 : cy[u]! + size[u]!.h / 2);
    cursor += TREE_GAP * 2;
  }

  // Posiciones manuales: relativas a la raíz (0,0); los descendientes sin posición propia las siguen.
  const dx = new Float64Array(N), dy = new Float64Array(N);
  const first = treeOf[0]?.[0];
  for (const u of vis) {
    const p = par[u]!;
    if (p >= 0) { dx[u] = dx[p]!; dy[u] = dy[p]!; }
    const n = nodes[u]!;
    if (u !== first && hasPos(n)) { dx[u] = n.x! - cx[u]!; dy[u] = n.y! - cy[u]!; }
  }
  const pos: Layout['pos'] = new Map();
  for (const u of vis) {
    const b = { x: r(cx[u]! + dx[u]!), y: r(cy[u]! + dy[u]!), w: size[u]!.w, h: size[u]!.h };
    if (!pos.has(nodes[u]!.id)) { pos.set(nodes[u]!.id, b); B.box(b); }
  }
  const paths: Layout['paths'] = new Map();
  for (const u of vis) {
    const p = par[u]!;
    if (p < 0) continue;
    const a = pos.get(nodes[p]!.id)!, b = pos.get(nodes[u]!.id)!;
    if (mode === 'radial') {
      const s = clip(a, b), t = clip(b, a);
      paths.set(nodes[u]!.id, `M ${pt(s)} L ${pt(t)}`);
    } else {
      const sgn = b.x >= a.x ? 1 : -1;
      const s = { x: a.x + sgn * a.w / 2, y: a.y }, t = { x: b.x - sgn * b.w / 2, y: b.y };
      paths.set(nodes[u]!.id, pathD([s, t], 'h', 'h', 'h', 'curva'));
    }
  }
  return { pos, paths, bounds: B.get() };
}

/** Punto del borde del rectángulo `a` en la recta hacia el centro de `b`. */
function clip(a: Box, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return { x: a.x, y: a.y };
  const t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: a.x + dx * t, y: a.y + dy * t };
}
