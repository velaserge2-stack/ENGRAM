import { describe, expect, it } from 'vitest';
import { appendLog, loadCollection, verifyDeterminism } from '../src/data/collection';
import { applyReview, DEFAULT_PARAMS, scheduler } from '../src/srs/engine';
import { buildQueue, dayEnd, deckCounts, nextCard, stateOf } from '../src/srs/queue';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { readText } from '../src/vault/util';

const TZ = 'America/Monterrey';
const LIM = { newPerDay: 3, reviewLimit: 200, recoveryThreshold: 5, leechThreshold: 8, tz: TZ, dayStartHour: 4 };
const NOW = Date.parse('2026-03-10T10:00:00-06:00');

async function vaultWith(n: number) {
  const v = new SafeVault(new MemoryBackend());
  const body = Array.from({ length: n }, (_, i) => `Q:: P${i}\nA:: R${i}${i % 2 ? ` ^id${i}` : ''}`).join('\n\n');
  await v.write('decks/A.md', `---\ndeck: A\n---\n${body}\n`);
  return v;
}

describe('colección y cola', () => {
  it('añade IDs faltantes al archivo y conserva los existentes', async () => {
    const v = await vaultWith(4);
    const col = await loadCollection(v, DEFAULT_PARAMS, NOW);
    expect(col.idsAdded).toBe(2);
    expect(col.decks[0]!.cards.map((c) => c.cid)).toContain('id1');
    const again = await loadCollection(v, DEFAULT_PARAMS, NOW);
    expect(again.idsAdded).toBe(0);
    expect((await readText(v, 'decks/A.md')).match(/\^/g)!.length).toBe(4);
  });

  it('límite de nuevas por día y conteos', async () => {
    const v = await vaultWith(10);
    const col = await loadCollection(v, DEFAULT_PARAMS, NOW);
    const d = col.decks[0]!;
    expect(deckCounts(col, d, NOW, LIM)).toEqual({ new: 3, learning: 0, due: 0 });
    const q = buildQueue(col, null, NOW, LIM, DEFAULT_PARAMS);
    expect(q.fresh.length).toBe(3);
  });

  it('repasar, registrar, reconstruir: el estado coincide (criterio fase 2)', async () => {
    const v = await vaultWith(6);
    let col = await loadCollection(v, DEFAULT_PARAMS, NOW);
    const f = scheduler(DEFAULT_PARAMS);
    let t = NOW;
    const q = buildQueue(col, null, NOW, LIM, DEFAULT_PARAMS);
    for (const cid of q.fresh) {
      const st = stateOf(col, cid);
      col.states.set(cid, st);
      const e = applyReview(f, st, cid, 3, (t += 30_000), 4000);
      await appendLog(v, col, [e], DEFAULT_PARAMS);
    }
    expect(deckCounts(col, col.decks[0]!, t, LIM).new).toBe(0);
    expect(deckCounts(col, col.decks[0]!, t, LIM).learning).toBe(3);
    // recargar desde caché y desde cero
    col = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(verifyDeterminism(col, DEFAULT_PARAMS).ok).toBe(true);
    await v.remove('.app/state.json');
    const fresh = await loadCollection(v, DEFAULT_PARAMS, t);
    for (const [k, s] of col.states) expect(JSON.stringify(fresh.states.get(k)!.card)).toBe(JSON.stringify(s.card));
  });

  it('editar a mano: texto cambiado conserva historial; ID borrado se archiva', async () => {
    const v = await vaultWith(2);
    const col = await loadCollection(v, DEFAULT_PARAMS, NOW);
    const cid = col.decks[0]!.cards[1]!.cid; // id1
    const st = stateOf(col, cid);
    col.states.set(cid, st);
    await appendLog(v, col, [applyReview(scheduler(DEFAULT_PARAMS), st, cid, 3, NOW, 1000)], DEFAULT_PARAMS);
    await v.write('decks/A.md', (await readText(v, 'decks/A.md')).replace('P1', 'Pregunta editada'));
    const c2 = await loadCollection(v, DEFAULT_PARAMS, NOW + 1000);
    expect(c2.states.get(cid)!.card.reps).toBe(1);
    await v.write('decks/A.md', (await readText(v, 'decks/A.md')).replace(/Q:: Pregunta editada[\s\S]*?\^id1/, ''));
    const c3 = await loadCollection(v, DEFAULT_PARAMS, NOW + 2000);
    expect(c3.archived.map((a) => a.cid)).toEqual([cid]);
    expect(c3.states.get(cid)!.card.reps).toBe(1); // historial intacto
  });

  it('modo recuperación: tope y días para ponerse al día', async () => {
    const v = await vaultWith(12);
    const col = await loadCollection(v, DEFAULT_PARAMS, NOW);
    const f = scheduler(DEFAULT_PARAMS);
    for (const ref of col.decks[0]!.cards) {
      const st = stateOf(col, ref.cid);
      col.states.set(ref.cid, st);
      for (const [dt, r] of [[0, 3], [600_000, 3], [86_400_000, 3]] as const) applyReview(f, st, ref.cid, r, NOW - 90 * 86_400_000 + dt, 1000);
    }
    const q = buildQueue(col, null, NOW, { ...LIM, reviewLimit: 4 }, DEFAULT_PARAMS);
    expect(q.dueTotal).toBe(12);
    expect(q.recovery).toEqual({ active: true, daysToCatchUp: 3, cap: 4 });
    expect(q.review.length).toBe(4);
    expect(nextCard(col, q, new Set(), new Set(), NOW, 0)).toBe(q.review[0]);
  });

  it('fin del día con corte a las 4:00', () => {
    expect(new Date(dayEnd(NOW, TZ, 4)).toISOString()).toBe('2026-03-11T10:00:00.000Z');
  });
});
