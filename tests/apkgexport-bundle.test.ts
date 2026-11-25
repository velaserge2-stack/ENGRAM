import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { bundleZip, containsFsrs, historyCsv } from '../src/io/apkgexport/bundle';
import type { LogEntry } from '../src/srs/engine';

const S = (n: number) => new Set(Array.from({ length: n }, (_, i) => i));

describe('containsFsrs', () => {
  it('matriz history × revlog × sched', () => {
    for (const history of [true, false]) for (const revlog of [0, 3]) for (const n of [0, 2])
      expect(containsFsrs({ history, revlog, sched: S(n) })).toBe(history && (revlog > 0 || n > 0));
  });
});

describe('historyCsv', () => {
  const log = [
    { id: 'a', ts: 2000, rating: 3, state: 2, ms: 4200 },
    { id: 'b', ts: 1000, rating: 1, state: 0 },
    { id: 'a', ts: 3000, rating: 4, state: 2 },
    { id: 'a', ts: 3500, op: 'undo', ref: 3000 },
    { id: 'c', ts: 500, rating: 2 },
    { id: 'a', ts: 4000, op: 'suspend' },
  ] as LogEntry[];
  it('solo exportadas, sin deshechos ni operaciones, ordenado', () => {
    const rows = historyCsv(log, new Set(['a', 'b'])).trim().split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('tarjeta,fecha,calificacion,estado,duracion_s');
    expect(rows[1]).toMatch(/^b,.+,1,nueva,0$/);
    expect(rows[2]).toMatch(/^a,.+,3,repaso,4$/);
  });
});

describe('bundleZip', () => {
  const apkg = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
  const o = { apkg, baseName: 'Engrama-a/b:c-2026', historyCsv: 'x,y\n', readme: 'hola\n' };
  it('tres entradas, .apkg intacto, nombres seguros', async () => {
    const z = unzipSync(new Uint8Array(await (await bundleZip(o)).arrayBuffer()));
    const names = Object.keys(z);
    expect(names).toHaveLength(3);
    expect(names).toContain('historial-repasos.csv');
    expect(names).toContain('LEEME.txt');
    const a = names.find((n) => n.endsWith('.apkg'))!;
    expect(a).not.toMatch(/[/:\\]/);
    expect(Array.from(z[a]!)).toEqual(Array.from(apkg));
    expect(strFromU8(z['historial-repasos.csv']!)).toBe('x,y\n');
    expect(strFromU8(z['LEEME.txt']!)).toBe('hola\n');
  });
  it('determinista y acepta Blob', async () => {
    const b1 = new Uint8Array(await (await bundleZip(o)).arrayBuffer());
    const b2 = new Uint8Array(await (await bundleZip({ ...o, apkg: new Blob([apkg as BlobPart]) })).arrayBuffer());
    expect(Array.from(b2)).toEqual(Array.from(b1));
  });
});
