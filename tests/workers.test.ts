/** Plan 14 · Workers con salida: el backend OPFS no queda colgado y la búsqueda no deja promesas sin resolver. */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Msg = { id: number; op: string };
class FakeWorker {
  static all: FakeWorker[] = [];
  static hang = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminated = false;
  constructor() { FakeWorker.all.push(this); }
  postMessage(m: Msg) {
    if (m.op === 'init') return void queueMicrotask(() => this.onmessage?.({ data: { id: m.id, ok: true, value: { strategy: 'x' } } }));
    if (FakeWorker.hang) return; // nunca responde
    if (m.op === 'hash') { // operación larga que avanza: señales de vida cada 50 ms durante 600 ms
      let n = 0;
      const t = setInterval(() => {
        if (++n < 12) return this.onmessage?.({ data: { id: m.id, alive: true } });
        clearInterval(t);
        this.onmessage?.({ data: { id: m.id, ok: true, value: { size: 1, hash: 'h' } } });
      }, 50);
      return;
    }
    queueMicrotask(() => this.onmessage?.({ data: { id: m.id, ok: true, value: m.op === 'exists' ? true : [] } }));
  }
  terminate() { this.terminated = true; }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.all = []; FakeWorker.hang = false; });

describe('plan 14: OPFSBackend con tiempo de espera', () => {
  it('una operación sin respuesta se rechaza con io, el Worker se recrea y lo siguiente funciona', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { OPFSBackend } = await import('../src/vault/opfs');
    OPFSBackend.TIMEOUT = 200;
    const b = await OPFSBackend.open();
    FakeWorker.hang = true;
    await expect(b.read('notes/a.md')).rejects.toMatchObject({ code: 'io' });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.hang = false;
    expect(await b.exists('notes/a.md')).toBe(true);
  });
  it('una operación larga que da señales de vida no se corta aunque dure más que TIMEOUT', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { OPFSBackend } = await import('../src/vault/opfs');
    OPFSBackend.TIMEOUT = 200;
    const b = await OPFSBackend.open();
    expect(await b.hash('pdfs/grande.pdf')).toEqual({ size: 1, hash: 'h' });
    expect(FakeWorker.all).toHaveLength(1); // no se reinició
  });
});

describe('plan 14: search-client tras la muerte del Worker', () => {
  it('lo pendiente se resuelve y el índice local se repuebla', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', FakeWorker);
    FakeWorker.hang = true;
    const { notesIndex } = await import('../src/notes/search-client');
    const r = notesIndex.reset(new Map([['notes/M/T/Bloqueos.md', '# Bloqueos\nbloqueo AV']]));
    const up = notesIndex.upsert('notes/M/T/Ondas.md', 'onda P');
    FakeWorker.all[0]!.onerror?.({ message: 'muerto' });
    await expect(Promise.all([r, up])).resolves.toBeTruthy();
    expect((await notesIndex.query('bloqueo')).map((x) => x.id)).toContain('notes/M/T/Bloqueos.md');
  });
});
