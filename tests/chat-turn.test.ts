// (g) un turno viejo que termina tarde no rompe «Detener» del nuevo.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pending: Array<{ signal: AbortSignal; done: (r: unknown) => void }> = [];
vi.mock('../src/chat/session', () => ({
  busy: () => false,
  runTurn: (o: { signal: AbortSignal }) => new Promise((res) => pending.push({ signal: o.signal, done: res })),
}));

beforeEach(() => { pending.length = 0; });

describe('turn', () => {
  it('(g) Detener corta el turno nuevo aunque el viejo termine tarde', async () => {
    const { send, stop } = await import('../src/chat/turn');
    const { clear } = await import('../src/chat/history');
    void send('uno');
    await new Promise((r) => setTimeout(r, 5));
    clear(); // «Nueva conversación»
    void send('dos');
    await new Promise((r) => setTimeout(r, 5));
    expect(pending).toHaveLength(2);
    pending[0]!.done({ ok: false, code: 'aborted', message: '', rotated: false }); // el viejo termina tarde
    await new Promise((r) => setTimeout(r, 5));
    stop();
    expect(pending[1]!.signal.aborted).toBe(true);
    pending[1]!.done({ ok: true, text: '', alias: 'a', rotated: false, tokens: 0 });
  });
  it('si falla import(./tools) el asistente no queda ocupado', async () => {
    const { send } = await import('../src/chat/turn');
    const { clear, getStatus } = await import('../src/chat/history');
    clear();
    vi.doMock('../src/chat/tools', () => { throw new Error('boom'); });
    await send('x', { vault: {} as never, col: null, today: '2026-01-01' });
    expect(getStatus().busy).toBe(false);
  });
});
