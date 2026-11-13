// Prompt 21 · 4: historial que solo se añade + punto de control de FSRS. El resultado incremental es
// idéntico bit a bit a la repetición completa (la verdad sigue siendo reviews.jsonl).
import { describe, expect, it } from 'vitest';
import { appendLog, type Collection, flushState, loadStates, REVIEWS, STATE } from '../src/data/collection';
import { applyReview, DEFAULT_PARAMS, type LogEntry, replay, type SrsParams } from '../src/srs/engine';
import { MemoryBackend } from '../src/vault/memory';
import { JOURNAL_PATH, SafeVault } from '../src/vault/safe';
import { decodeText, readTextOr } from '../src/vault/util';

const P: SrsParams = DEFAULT_PARAMS;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Historial hostil: fuera de orden, ts iguales, deshacer, operaciones y líneas dañadas. */
function hostileLog(n: number, cards: number, seed: number): string[] {
  const r = rng(seed);
  const t0 = Date.UTC(2025, 0, 1);
  const lines: string[] = [];
  const rated: { id: string; ts: number }[] = [];
  let lastTs = 0;
  for (let i = 0; i < n; i++) {
    const id = `n${Math.floor(r() * cards)}:0`;
    const x = r();
    let ts = t0 + i * 600_000 + Math.floor(r() * 3) * 60_000;
    if (x < 0.03) ts -= Math.floor(r() * 30) * 86_400_000; // fuera de orden
    if (x > 0.97 && lastTs) ts = lastTs; // mismo ts que la anterior
    if (x < 0.01) { lines.push('{"id":"roto"'); continue; } // dañada
    if (x > 0.99) { lines.push('no es json'); continue; }
    if (x > 0.95 && x <= 0.96 && rated.length) {
      const u = rated[Math.floor(r() * rated.length)]!;
      lines.push(JSON.stringify({ id: u.id, ts, op: 'undo', ref: u.ts }));
      continue;
    }
    if (x > 0.96 && x <= 0.97) { lines.push(JSON.stringify({ id, ts, op: ['suspend', 'unsuspend', 'bury', 'forget'][Math.floor(r() * 4)] })); continue; }
    lastTs = ts;
    const e = { id, ts, rating: 1 + Math.floor(r() * 4), ms: 5000 };
    rated.push({ id, ts });
    lines.push(JSON.stringify(e));
  }
  return lines;
}

const dump = (m: Map<string, unknown>) => JSON.stringify([...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

async function vaultWith(text: string) {
  const v = new SafeVault(new MemoryBackend());
  if (text) await v.write(REVIEWS, text);
  return v;
}

describe('punto de control de FSRS', () => {
  it('100 000 repasos hostiles: incremental (corte al azar) idéntico bit a bit a la repetición completa', async () => {
    const lines = hostileLog(100_000, 20_000, 7);
    const cut = 73_517;
    const v = await vaultWith(lines.slice(0, cut).join('\n') + '\n');
    const first = await loadStates(v, P); // completa: escribe el punto de control
    expect(first.rebuilt).toBe(true);
    await v.append(REVIEWS, new TextEncoder().encode(lines.slice(cut).join('\n') + '\n'));
    const inc = await loadStates(v, P);
    expect(inc.rebuilt).toBe(false);
    const all = replay(inc.log, P);
    expect(dump(inc.states)).toBe(dump(all));
  }, 60_000);

  it('muchos cortes (incluido 0 y el final) con 3 000 repasos: siempre idéntico', async () => {
    const lines = hostileLog(3000, 300, 11);
    const r = rng(3);
    for (const cut of [0, 1, 2999, 3000, ...Array.from({ length: 12 }, () => Math.floor(r() * 3000))]) {
      const v = await vaultWith(lines.slice(0, cut).join('\n') + (cut ? '\n' : ''));
      await loadStates(v, P);
      if (cut < lines.length) await v.append(REVIEWS, new TextEncoder().encode(lines.slice(cut).join('\n') + '\n'));
      const inc = await loadStates(v, P);
      expect(dump(inc.states), `corte ${cut}`).toBe(dump(replay(inc.log, P)));
    }
  });

  it('el principio del archivo cambia, se trunca, otros parámetros o caché v1/dañada: reconstrucción completa', async () => {
    const lines = hostileLog(500, 50, 5);
    const text = lines.join('\n') + '\n';
    for (const spoil of [
      async (v: SafeVault) => v.write(REVIEWS, text.replace('"rating":1', '"rating":2')), // editado al principio
      async (v: SafeVault) => v.write(REVIEWS, text.slice(0, 200)), // truncado
      async (v: SafeVault) => v.write(STATE, '{"key":"x","cards":{}}'), // caché v1
      async (v: SafeVault) => v.write(STATE, '{roto'),
    ]) {
      const v = await vaultWith(text);
      await loadStates(v, P);
      await spoil(v);
      const r = await loadStates(v, P);
      expect(r.rebuilt).toBe(true);
      expect(dump(r.states)).toBe(dump(replay(r.log, P)));
    }
    const v = await vaultWith(text);
    await loadStates(v, P);
    expect((await loadStates(v, { ...P, retention: 0.85 } as SrsParams)).rebuilt).toBe(true);
  });

  it('estudiar: cada respuesta solo añade (sin reescribir) y el state.json diferido casa con el historial', async () => {
    const raw = new MemoryBackend();
    const v = new SafeVault(raw);
    await v.write(REVIEWS, hostileLog(2000, 100, 9).join('\n') + '\n');
    const s = await loadStates(v, P);
    const col = { states: s.states, log: s.log, logAt: s.at, logFnv: s.fnv } as unknown as Collection;
    const { scheduler } = await import('../src/srs/engine');
    const f = scheduler(P);
    const writes: string[] = [];
    const w = raw.write.bind(raw);
    raw.write = async (p, d) => (writes.push(p), w(p, d));
    for (let i = 0; i < 20; i++) {
      const id = `n${i % 7}:0`;
      const st = col.states.get(id) ?? (await import('../src/srs/engine')).newState(Date.now());
      const e: LogEntry = applyReview(f, st, id, (1 + (i % 4)) as 1, Date.UTC(2026, 5, 1) + i * 60_000, 3000);
      col.states.set(id, st);
      await appendLog(v, col, [e], P);
    }
    expect(writes.filter((p) => p === REVIEWS)).toEqual([]); // ni una reescritura del historial
    expect(writes.filter((p) => p === STATE)).toEqual([]); // state.json todavía no (diferido)
    await flushState();
    expect(writes.filter((p) => p === STATE)).toHaveLength(1);
    const again = await loadStates(v, P);
    expect(again.rebuilt).toBe(false);
    expect(dump(again.states)).toBe(dump(replay(again.log, P)));
    expect(dump(again.states)).toBe(dump(col.states));
  });
});

describe('SafeVault.append: muerte en cada paso', () => {
  class Mortal extends MemoryBackend {
    limit = Infinity;
    n = 0;
    private tick() { if (this.n++ >= this.limit) throw new Error('muerte'); }
    override async write(p: string, d: Uint8Array | string) { this.tick(); return super.write(p, d); }
    override async remove(p: string) { this.tick(); return super.remove(p); }
    override async appendAt(p: string, d: Uint8Array, at: number, sep?: boolean) { this.tick(); return super.appendAt(p, d, at, sep); }
  }
  it('el archivo queda como antes o con la línea entera una sola vez; sin diario; sin separador doble', async () => {
    for (const before of ['', 'a\n', 'b sin salto']) {
      for (let k = 0; k < 6; k++) {
        const m = new Mortal();
        if (before) await m.write('x.jsonl', before);
        m.n = 0;
        m.limit = k;
        await new SafeVault(m).append('x.jsonl', new TextEncoder().encode('linea\n')).catch(() => {});
        m.limit = Infinity;
        await new SafeVault(m).recover();
        const t = await readTextOr(m, 'x.jsonl', '');
        const done = before ? (before.endsWith('\n') ? before : `${before}\n`) + 'linea\n' : 'linea\n';
        expect([before, done], `antes «${before}», corte ${k}: «${t}»`).toContain(t);
        expect(await m.exists(JOURNAL_PATH)).toBe(false);
      }
    }
  });
  it('sin appendAt en el backend: se reescribe con commit, mismo resultado', async () => {
    const m = new MemoryBackend();
    (m as unknown as { appendAt?: unknown }).appendAt = undefined;
    await m.write('x.jsonl', 'a');
    const r = await new SafeVault(m).append('x.jsonl', new TextEncoder().encode('b\n'));
    expect(decodeText(await m.read('x.jsonl'))).toBe('a\nb\n');
    expect(r).toEqual({ at: 1, written: new TextEncoder().encode('\nb\n') });
  });
});
