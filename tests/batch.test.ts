// Prompt 21 · 3a: lote con un solo diario en SafeVault. Recuperación todo-o-nada en cada paso.
import { describe, expect, it } from 'vitest';
import { moveNotes } from '../src/notes/move';
import { checkIntegrity } from '../src/vault/integrity';
import { MemoryBackend } from '../src/vault/memory';
import { batch, JOURNAL_PATH, SafeVault, TMP_DIR } from '../src/vault/safe';
import type { BlobWriteOptions } from '../src/vault/types';
import { checksum, decodeText, readText, walk } from '../src/vault/util';

/** Backend que «muere» antes de la operación de escritura número `limit` (y ya no hace nada más). */
class Mortal extends MemoryBackend {
  limit = Infinity;
  ops: string[] = [];
  private tick(op: string, p: string) {
    if (this.ops.length >= this.limit) throw new Error('muerte');
    this.ops.push(`${op} ${p}`);
  }
  override async move(a: string, b: string) { this.tick('move', `${a} → ${b}`); return super.move(a, b); }
  override async remove(p: string) { this.tick('remove', p); return super.remove(p); }
  override async writeBlob(p: string, b: Blob, o?: BlobWriteOptions) { this.tick('writeBlob', p); return super.writeBlob(p, b, o); }
  override async create(p: string, d: Uint8Array) { this.tick('create', p); return super.create(p, d); }
  /** Diarios escritos (para ver su versión y sus destinos nuevos). */
  journals: { v: number; fresh?: { path: string }[]; freshDirs?: string[] }[] = [];
  override async write(p: string, d: Uint8Array | string) {
    this.tick('write', p);
    if (p === JOURNAL_PATH) this.journals.push(JSON.parse(typeof d === 'string' ? d : decodeText(d)));
    return super.write(p, d);
  }
}

async function snapshot(m: MemoryBackend): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of await walk(m, '')) out[f.path] = decodeText(await m.read(f.path));
  return out;
}

async function seed(m: MemoryBackend) {
  await m.write('notes/a.md', 'A');
  await m.write('notes/b.md', 'B');
  await m.write('notes/caso.md', 'caso');
  await m.write('notes/vieja/x.md', 'X');
  await m.write('notes/vieja/sub/y.md', 'Y');
  await m.write('decks/d.md', 'D viejo');
  await m.write('notes/borrar.md', 'borrar');
}

/** El lote de prueba: nuevo, sobrescribir, blob, mover, mover y reescribir, solo mayúsculas, borrar archivo y carpeta. */
async function work(tx: SafeVault | import('../src/vault/types').VaultAdapter) {
  await tx.write('notes/nueva.md', 'nueva');
  await tx.write('decks/d.md', 'D nuevo');
  await (tx as unknown as { writeStream(p: string, b: Blob): Promise<void> }).writeStream('media/f.bin', new Blob(['blob-bytes']));
  await tx.move('notes/a.md', 'notes/M/a.md');
  await tx.move('notes/b.md', 'notes/M/b.md');
  await tx.write('notes/M/b.md', `${decodeText(await tx.read('notes/M/b.md'))} editada`);
  await tx.move('notes/caso.md', 'notes/caso.md.1.mv');
  await tx.move('notes/caso.md.1.mv', 'notes/Caso.md');
  await tx.remove('notes/borrar.md');
  await tx.remove('notes/vieja');
}

async function expected() {
  const m = new MemoryBackend();
  await seed(m);
  const before = await snapshot(m);
  await new SafeVault(m).batch(work);
  return { before, after: await snapshot(m) };
}

describe('SafeVault.batch: vista del lote', () => {
  it('las lecturas ven lo pendiente; si la función lanza no se escribe nada', async () => {
    const m = new MemoryBackend();
    await seed(m);
    const before = await snapshot(m);
    const v = new SafeVault(m);
    await expect(v.batch(async (tx) => {
      await tx.move('notes/a.md', 'notes/M/a.md');
      expect(await tx.exists('notes/a.md')).toBe(false);
      expect(await readText(tx, 'notes/M/a.md')).toBe('A');
      expect((await walk(tx, 'notes')).map((f) => f.path)).toContain('notes/M/a.md');
      await tx.remove('notes/vieja');
      expect(await tx.exists('notes/vieja/x.md')).toBe(false);
      expect((await tx.list('notes')).some((e) => e.path === 'notes/vieja')).toBe(false);
      await tx.write('notes/vieja/z.md', 'Z'); // la carpeta vuelve a tener algo
      expect((await walk(tx, 'notes/vieja')).map((f) => f.path)).toEqual(['notes/vieja/z.md']);
      throw new Error('cancelado');
    })).rejects.toThrow('cancelado');
    expect(await snapshot(m)).toEqual(before);
  });

  it('resultado igual al de las operaciones sueltas, un solo diario y sin rastro', async () => {
    const a = new MemoryBackend(), b = new Mortal();
    await seed(a);
    await seed(b);
    await work(new SafeVault(a)); // una transacción por operación
    b.ops = [];
    await new SafeVault(b).batch(work);
    expect(await snapshot(b)).toEqual(await snapshot(a));
    expect(b.ops.filter((o) => o === `write ${JOURNAL_PATH}`)).toHaveLength(1);
    expect(await b.exists(JOURNAL_PATH)).toBe(false);
    expect((await walk(b, TMP_DIR)).length).toBe(0);
  });

  it('origen que vuelve a escribirse dentro del lote: se copia antes (cadena a→b, c→a)', async () => {
    const m = new MemoryBackend();
    await m.write('a.md', 'A');
    await m.write('c.md', 'C');
    await batch(new SafeVault(m), async (tx) => {
      await tx.move('a.md', 'b.md');
      await tx.move('c.md', 'a.md');
      await tx.move('b.md', 'z/b.md');
      await tx.move('z/b.md', 'b.md'); // ida y vuelta dentro del lote
    });
    expect(await snapshot(m)).toEqual({ 'a.md': 'C', 'b.md': 'A' });
  });

  it('una carpeta borrada solo se quita si queda vacía', async () => {
    const m = new MemoryBackend();
    await m.write('notes/t/a.md', 'A');
    const v = new SafeVault(m);
    await v.batch(async (tx) => {
      await tx.remove('notes/t');
      await m.write('notes/t/otro.md', 'llegó mientras'); // otro escritor entre la vista y la confirmación
    });
    expect(await snapshot(m)).toEqual({ 'notes/t/otro.md': 'llegó mientras' });
  });

  it('mover 30 notas: un diario (antes 2 por nota)', async () => {
    const m = new Mortal();
    for (let i = 0; i < 30; i++) await m.write(`notes/Lote/n${i}.md`, `---\nmateria: Lote\n---\n[[Lote/n${(i + 1) % 30}]]`);
    m.ops = [];
    const r = await moveNotes(new SafeVault(m), (await walk(m, 'notes/Lote')).map((f) => f.path), 'Otra/Tema');
    expect(r.moved).toHaveLength(30);
    expect(m.ops.filter((o) => o === `write ${JOURNAL_PATH}`)).toHaveLength(1);
    expect(await readText(m, 'notes/Otra/Tema/n0.md')).toBe('---\nmateria: Otra\ntema: Tema\n---\n[[Otra/Tema/n1]]');
  });
});

describe('SafeVault.batch: progreso y Cancelar', () => {
  it('cancelar mientras se escriben los temporales: no cambia nada, sin temporales ni diario', async () => {
    const m = new MemoryBackend();
    await seed(m);
    const before = await snapshot(m);
    const ac = new AbortController();
    const seen: number[] = [];
    await expect(new SafeVault(m).batch(work, { signal: ac.signal, onProgress: (d) => (seen.push(d), d === 1 && ac.abort()) })).rejects.toThrow(/Cancelado/);
    expect(await snapshot(m)).toEqual(before);
    expect(await m.exists(JOURNAL_PATH)).toBe(false);
    expect(await m.exists(TMP_DIR)).toBe(false);
    expect(seen).toEqual([0, 1]);
  });
  it('sin cancelar: progreso de 0 a total y el mismo resultado', async () => {
    const { after } = await expected();
    const m = new MemoryBackend();
    await seed(m);
    const seen: [number, number][] = [];
    await new SafeVault(m).batch(work, { onProgress: (d, n) => seen.push([d, n]) });
    expect(await snapshot(m)).toEqual(after);
    const n = seen[0]![1];
    expect(seen.at(-1)).toEqual([n, n]);
    expect(seen.map((x) => x[0])).toEqual([...seen.map((x) => x[0])].sort((a, b) => a - b));
  });
});

describe('SafeVault.batch: recuperación tras morir en cada paso', () => {
  it('todo o nada en cada punto de corte; sin temporales ni diario; integridad solo reporta', async () => {
    const { before, after } = await expected();
    const probe = new Mortal();
    await seed(probe);
    probe.ops = [];
    await new SafeVault(probe).batch(work);
    const total = probe.ops.length;
    expect(total).toBeGreaterThan(8);
    const seen = new Set<string>();
    for (let k = 0; k <= total; k++) {
      const m = new Mortal();
      await seed(m);
      m.ops = [];
      m.limit = k;
      await new SafeVault(m).batch(work).catch(() => {});
      m.limit = Infinity;
      const rep = await new SafeVault(m).recover(); // «reabrir»
      const s = await snapshot(m);
      const which = JSON.stringify(s) === JSON.stringify(after) ? 'after' : JSON.stringify(s) === JSON.stringify(before) ? 'before' : null;
      expect(which, `corte ${k} (${probe.ops[k] ?? 'fin'}): ${JSON.stringify(rep)}`).not.toBeNull();
      seen.add(which!);
      expect(await m.exists(JOURNAL_PATH)).toBe(false);
      expect(await m.exists(TMP_DIR)).toBe(false);
      const snap = await snapshot(m);
      await checkIntegrity(m);
      expect(await snapshot(m)).toEqual(snap);
    }
    expect([...seen].sort()).toEqual(['after', 'before']);
  });

  it('morir también durante la recuperación: la siguiente recuperación termina igual (todo o nada)', async () => {
    const { before, after } = await expected();
    const probe = new Mortal();
    await seed(probe);
    probe.ops = [];
    await new SafeVault(probe).batch(work);
    const total = probe.ops.length;
    for (let k = 0; k <= total; k++) {
      // cuántas operaciones hace la recuperación tras el corte k
      const r0 = new Mortal();
      await seed(r0);
      r0.limit = k;
      r0.ops = [];
      await new SafeVault(r0).batch(work).catch(() => {});
      r0.limit = Infinity;
      r0.ops = [];
      await new SafeVault(r0).recover();
      const rec = r0.ops.length;
      for (let j = 0; j < rec; j++) {
        const m = new Mortal();
        await seed(m);
        m.limit = k;
        m.ops = [];
        await new SafeVault(m).batch(work).catch(() => {});
        m.ops = [];
        m.limit = j; // la recuperación muere en su paso j
        await new SafeVault(m).recover().catch(() => {});
        m.limit = Infinity;
        await new SafeVault(m).recover(); // se vuelve a abrir
        const st = JSON.stringify(await snapshot(m));
        expect(st === JSON.stringify(after) || st === JSON.stringify(before), `corte ${k}, recuperación cortada en ${j}`).toBe(true);
        expect(await m.exists(JOURNAL_PATH)).toBe(false);
        expect(await m.exists(TMP_DIR)).toBe(false);
      }
    }
  });

  it('temporal dañado antes de aplicar nada: se revierte el lote entero', async () => {
    const m = new MemoryBackend();
    await seed(m);
    const before = await snapshot(m);
    const m2 = new MemoryBackend();
    await seed(m2);
    await m2.write(`${TMP_DIR}/t1`, 'nuev'); // truncado
    await m2.write(`${TMP_DIR}/t2`, 'D nuevo');
    await m2.write(JOURNAL_PATH, JSON.stringify({ v: 2, ts: 1, writes: [
      { path: 'notes/nueva.md', tmp: `${TMP_DIR}/t1`, size: 5, hash: checksum(new TextEncoder().encode('nueva')) },
      { path: 'decks/d.md', tmp: `${TMP_DIR}/t2`, size: 7, hash: checksum(new TextEncoder().encode('D nuevo')) },
    ], moves: [{ from: 'notes/a.md', to: 'notes/M/a.md' }], removes: ['notes/borrar.md'], dirs: [] }));
    const rep = await new SafeVault(m2).recover();
    expect(rep.recovered).toEqual([]);
    expect(rep.discarded.sort()).toEqual(['decks/d.md', 'notes/M/a.md', 'notes/nueva.md']);
    expect(await snapshot(m2)).toEqual(before);
    expect(await m2.exists(JOURNAL_PATH)).toBe(false);
  });

  it('diario v2 plantado: rutas fuera de lugar se descartan; carpetas con archivos no se borran', async () => {
    const m = new MemoryBackend();
    await seed(m);
    const before = await snapshot(m);
    await m.write(JOURNAL_PATH, JSON.stringify({ v: 2, ts: 1, writes: [], moves: [{ from: '../x', to: 'a' }], removes: ['notes/a.md'], dirs: [] }));
    expect((await new SafeVault(m).recover()).discarded).toEqual(['?']);
    await m.write(JOURNAL_PATH, JSON.stringify({ v: 2, ts: 1, writes: [], moves: [{ from: 'notes/vieja', to: 'otra' }], removes: [], dirs: [] }));
    await new SafeVault(m).recover();
    await m.write(JOURNAL_PATH, JSON.stringify({ v: 2, ts: 1, writes: [], moves: [], removes: [], dirs: ['notes'] }));
    await new SafeVault(m).recover();
    expect(await snapshot(m)).toEqual(before);
  });

  it('un diario v1 antiguo se sigue recuperando', async () => {
    const m = new MemoryBackend();
    await m.write('notes/a.md', 'viejo');
    await m.write('decks/x.md', 'X');
    await m.write(`${TMP_DIR}/v1a`, 'nuevo');
    await m.write(`${TMP_DIR}/v1b`, 'X');
    const enc = new TextEncoder();
    await m.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [
      { op: 'write', path: 'notes/a.md', tmp: `${TMP_DIR}/v1a`, size: 5, hash: checksum(enc.encode('nuevo')), ts: 1 },
      { op: 'move', path: 'decks/y.md', from: 'decks/x.md', tmp: `${TMP_DIR}/v1b`, size: 1, hash: checksum(enc.encode('X')), ts: 1 },
    ] }));
    const rep = await new SafeVault(m).recover();
    expect(rep.recovered).toEqual(['notes/a.md', 'decks/y.md']);
    expect(await snapshot(m)).toEqual({ 'notes/a.md': 'nuevo', 'decks/y.md': 'X' });
  });

  it('apply fallido con la app viva: se reintenta comprobando y la siguiente operación termina el lote', async () => {
    const { after } = await expected();
    const m = new Mortal();
    await seed(m);
    m.ops = [];
    const v = new SafeVault(m);
    const probe = new Mortal();
    await seed(probe);
    probe.ops = [];
    await new SafeVault(probe).batch(work);
    m.limit = probe.ops.indexOf(`write ${JOURNAL_PATH}`) + 3; // muere a mitad de aplicar; el reintento también falla
    await expect(v.batch(work)).rejects.toThrow('muerte');
    m.limit = Infinity;
    await v.write('notes/otra.md', 'otra'); // settle → completa el lote antes
    const s = await snapshot(m);
    delete s['notes/otra.md'];
    expect(s).toEqual(after);
  });
});

// Prompt 21-B: archivos nuevos sin renombrar (diario v4). Un destino que no existía se escribe directo tras
// el diario; si el lote no llega a aplicarse, la recuperación lo borra (nunca existió). Lo demás, como v2.
type Work = (tx: SafeVault | import('../src/vault/types').VaultAdapter) => Promise<void>;

/** Mezcla: nuevos en carpetas nuevas anidadas y en una existente, sobrescribir, blob, mayúsculas, mover y borrar. */
const workMix: Work = async (tx) => {
  for (let i = 0; i < 4; i++) await tx.write(`notes/Nueva/Sub${i % 2}/n${i}.md`, `nueva ${i}`);
  await tx.write('notes/suelta.md', 'suelta');
  await tx.write('notes/Dup.md', 'dup mayúscula');
  await tx.write('notes/dup.md', 'dup minúscula');
  await tx.write('notes/CASO.md', 'otro caso'); // existe «caso.md»: no se trata como nuevo
  await tx.write('decks/d.md', 'D nuevo');
  await (tx as unknown as { writeStream(p: string, b: Blob): Promise<void> }).writeStream('media/g.bin', new Blob(['blob en carpeta nueva']));
  await tx.write('media/h.txt', 'junto al blob');
  await tx.move('notes/a.md', 'notes/Nueva/a.md');
  await tx.remove('notes/borrar.md');
  await tx.remove('notes/vieja');
};
/** Sin destinos nuevos: el diario sigue siendo v2, idéntico al de antes. */
const workOld: Work = async (tx) => {
  await tx.write('decks/d.md', 'D nuevo');
  await tx.write('notes/b.md', 'B editada');
  await (tx as unknown as { writeStream(p: string, b: Blob): Promise<void> }).writeStream('media/f.bin', new Blob(['blob-bytes']));
  await tx.move('notes/a.md', 'notes/vieja/a.md');
  await tx.move('notes/caso.md', 'notes/Caso.md');
  await tx.remove('notes/borrar.md');
};

async function outcome(w: Work) {
  const m = new Mortal();
  await seed(m);
  const before = await snapshot(m);
  m.ops = [];
  await new SafeVault(m).batch(w);
  return { before, after: await snapshot(m), ops: m.ops, journal: m.journals[0]! };
}

describe('SafeVault.batch: archivos nuevos sin renombrar (diario v4)', () => {
  it('los nuevos se escriben directo (sin temporal ni renombrado); existentes, blobs y mayúsculas siguen por temporal', async () => {
    const { ops, journal } = await outcome(workMix);
    expect(journal.v).toBe(4);
    const fresh = journal.fresh!.map((f) => f.path).sort();
    expect(fresh).toEqual(['media/h.txt', 'notes/Nueva/Sub0/n0.md', 'notes/Nueva/Sub0/n2.md', 'notes/Nueva/Sub1/n1.md', 'notes/Nueva/Sub1/n3.md', 'notes/suelta.md']);
    expect(journal.freshDirs!.sort()).toEqual(['media', 'notes/Nueva', 'notes/Nueva/Sub0', 'notes/Nueva/Sub1']);
    // el diario va antes de cualquier destino nuevo; cada nuevo es UNA operación
    const j = ops.indexOf(`write ${JOURNAL_PATH}`);
    for (const p of fresh) {
      expect(ops.indexOf(`create ${p}`)).toBeGreaterThan(j);
      expect(ops.filter((o) => o.includes(p))).toEqual([`create ${p}`]);
    }
    for (const p of ['notes/Dup.md', 'notes/dup.md', 'notes/CASO.md', 'decks/d.md', 'media/g.bin']) expect(ops.some((o) => o.startsWith('move .app/tmp/') && o.endsWith(`→ ${p}`)), p).toBe(true);
    expect(ops.filter((o) => o === `write ${JOURNAL_PATH}`)).toHaveLength(1);
  });

  it('sin destinos nuevos el diario es v2, como antes', async () => {
    expect((await outcome(workOld)).journal.v).toBe(2);
    expect(Object.keys((await outcome(workOld)).journal)).not.toContain('fresh');
  });

  for (const [name, w] of [['v4 (nuevos y existentes mezclados)', workMix], ['v2 (sin nuevos)', workOld]] as const) {
    it(`${name}: muerte en cada operación y en cada paso de la recuperación → antes o después, sin diario ni temporales`, async () => {
      const { before, after, ops } = await outcome(w);
      const B = JSON.stringify(before), A = JSON.stringify(after);
      const seen = new Set<string>();
      const cut = async (k: number) => {
        const m = new Mortal();
        await seed(m);
        m.ops = [];
        m.limit = k;
        await new SafeVault(m).batch(w).catch(() => {});
        m.limit = Infinity;
        return m;
      };
      for (let k = 0; k <= ops.length; k++) {
        const m = await cut(k);
        m.ops = [];
        await new SafeVault(m).recover(); // «reabrir»
        const rec = m.ops.length;
        const st = JSON.stringify(await snapshot(m));
        expect(st === A || st === B, `corte ${k} (${ops[k] ?? 'fin'})`).toBe(true);
        seen.add(st === A ? 'after' : 'before');
        expect(await m.exists(JOURNAL_PATH)).toBe(false);
        expect(await m.exists(TMP_DIR)).toBe(false);
        if (st === B) for (const d of ['notes/Nueva', 'media']) expect(await m.exists(d), `${d} tras revertir en ${k}`).toBe(false); // ni carpetas vacías
        await checkIntegrity(m);
        expect(JSON.stringify(await snapshot(m))).toBe(st); // la integridad solo reporta
        for (let r = 0; r < rec; r++) {
          const m2 = await cut(k);
          m2.ops = [];
          m2.limit = r; // la recuperación muere en su paso r
          await new SafeVault(m2).recover().catch(() => {});
          m2.limit = Infinity;
          await new SafeVault(m2).recover();
          const st2 = JSON.stringify(await snapshot(m2));
          expect(st2 === A || st2 === B, `corte ${k}, recuperación cortada en ${r}`).toBe(true);
          expect(await m2.exists(JOURNAL_PATH)).toBe(false);
          expect(await m2.exists(TMP_DIR)).toBe(false);
        }
      }
      expect([...seen].sort()).toEqual(['after', 'before']);
    });
  }

  it('un destino que aparece a mitad (otro escritor) no se pisa ni se borra: el lote no cambia nada', async () => {
    class Intruso extends Mortal {
      override async create(p: string, d: Uint8Array) {
        if (p === 'notes/Nueva/Sub1/n3.md') await MemoryBackend.prototype.write.call(this, p, 'de otro escritor');
        return super.create(p, d);
      }
    }
    const m = new Intruso();
    await seed(m);
    const before = await snapshot(m);
    await expect(new SafeVault(m).batch(workMix)).rejects.toThrow(/Apareció un archivo/);
    expect(await snapshot(m)).toEqual({ ...before, 'notes/Nueva/Sub1/n3.md': 'de otro escritor' });
    expect(await m.exists(JOURNAL_PATH)).toBe(false);
    expect(await m.exists(TMP_DIR)).toBe(false);
  });

  it('un destino que aparece mientras la app está cerrada tampoco se borra al revertir', async () => {
    const { before, ops } = await outcome(workMix);
    const m = new Mortal();
    await seed(m);
    m.ops = [];
    m.limit = ops.indexOf(`write ${JOURNAL_PATH}`) + 2; // escribe un nuevo y muere
    await new SafeVault(m).batch(workMix).catch(() => {});
    m.limit = Infinity;
    await m.write('notes/suelta.md', 'llegó de fuera'); // destino nuevo aún sin escribir
    const rep = await new SafeVault(m).recover();
    expect(await snapshot(m)).toEqual({ ...before, 'notes/suelta.md': 'llegó de fuera' });
    expect(rep.recovered).toEqual([]);
    expect(await m.exists(JOURNAL_PATH)).toBe(false);
    expect(await m.exists(TMP_DIR)).toBe(false);
  });

  it('un nuevo creado vacío y sin escribir (muerte a mitad de la escritura) se borra al revertir', async () => {
    class Corte extends Mortal {
      override async create(p: string, d: Uint8Array) {
        if (p === 'notes/Nueva/Sub0/n2.md') {
          await MemoryBackend.prototype.write.call(this, p, '');
          throw new Error('muerte');
        }
        return super.create(p, d);
      }
    }
    const { before } = await outcome(workMix);
    const m = new Corte();
    await seed(m);
    const v = new SafeVault(m);
    m.limit = Infinity;
    (m as unknown as { remove: unknown }).remove = async () => { throw new Error('muerta'); }; // tampoco puede revertir viva
    await expect(v.batch(workMix)).rejects.toThrow('muerte');
    expect(await m.exists(JOURNAL_PATH)).toBe(true);
    delete (m as unknown as { remove?: unknown }).remove;
    await new SafeVault(m).recover();
    expect(await snapshot(m)).toEqual(before);
    expect(await m.exists('notes/Nueva')).toBe(false);
    expect(await m.exists(TMP_DIR)).toBe(false);
  });

  it('Cancelar mientras se escriben los nuevos: se revierte y no cambia nada', async () => {
    const { before } = await outcome(workMix);
    const m = new MemoryBackend();
    await seed(m);
    const ac = new AbortController();
    await expect(new SafeVault(m).batch(workMix, { signal: ac.signal, onProgress: (d) => d === 6 && ac.abort() })).rejects.toThrow(/Cancelado/);
    expect(await snapshot(m)).toEqual(before);
    expect(await m.exists('notes/Nueva')).toBe(false);
    expect(await m.exists(JOURNAL_PATH)).toBe(false);
    expect(await m.exists(TMP_DIR)).toBe(false);
  });

  it('diario v4 plantado con rutas fuera de lugar o sin lista de nuevos: se descarta sin tocar nada', async () => {
    const m = new MemoryBackend();
    await seed(m);
    const before = await snapshot(m);
    const h = checksum(new TextEncoder().encode('A'));
    for (const bad of [
      { v: 4, ts: 1, writes: [], moves: [], removes: [], dirs: [], fresh: [{ path: '../a.md', size: 1, hash: h }], freshDirs: [] },
      { v: 4, ts: 1, writes: [], moves: [], removes: [], dirs: [], fresh: [{ path: 'notes/a.md', size: 1, hash: h }], freshDirs: ['.app/tmp'] },
      { v: 4, ts: 1, writes: [], moves: [], removes: [], dirs: [] },
    ]) {
      await m.write(JOURNAL_PATH, JSON.stringify(bad));
      expect((await new SafeVault(m).recover()).discarded).toEqual(['?']);
      expect(await snapshot(m)).toEqual(before);
    }
  });
});

describe('SafeVault.batch v4: escritura a medias de un archivo nuevo (OPFS)', () => {
  /** Como OPFS: `create` escribe con el sync access handle (vacía y escribe por trozos): un corte deja un parcial. */
  class HalfOPFS extends MemoryBackend {
    die = false;
    constructor() {
      super();
      Object.defineProperty(this, 'kind', { value: 'opfs' }); // la regla de recuperación mira el tipo de backend
    }
    override async create(p: string, d: Uint8Array) {
      if (await this.exists(p)) return false;
      if (this.die) { await super.write(p, d.slice(0, Math.max(1, d.length >> 1))); throw new Error('muerte a mitad de escribir'); }
      await super.write(p, d);
      return true;
    }
  }
  it('al reabrir se revierte entero: el parcial no queda en la bóveda', async () => {
    const m = new HalfOPFS();
    await m.write('notes/vieja.md', 'vieja');
    const before = await snapshot(m);
    m.die = true;
    await new SafeVault(m).batch(async (tx) => {
      await tx.write('notes/a.md', 'contenido largo de la nota a');
      await tx.write('notes/b.md', 'contenido largo de la nota b');
      await tx.write('notes/vieja.md', 'vieja editada');
    }).catch(() => {});
    m.die = false;
    await new SafeVault(m).recover();
    expect(await snapshot(m)).toEqual(before);
    expect(await m.exists(JOURNAL_PATH)).toBe(false);
  });
});
