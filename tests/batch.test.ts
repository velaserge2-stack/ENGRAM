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
  override async write(p: string, d: Uint8Array | string) { this.tick('write', p); return super.write(p, d); }
  override async move(a: string, b: string) { this.tick('move', `${a} → ${b}`); return super.move(a, b); }
  override async remove(p: string) { this.tick('remove', p); return super.remove(p); }
  override async writeBlob(p: string, b: Blob, o?: BlobWriteOptions) { this.tick('writeBlob', p); return super.writeBlob(p, b, o); }
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
