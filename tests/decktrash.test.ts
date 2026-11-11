import { describe, expect, it } from 'vitest';
import { appendLog, loadCollection } from '../src/data/collection';
import { autoPurge, DECK_TRASH, listTrash, purgeTrash, restoreTrash, trashDecks, trashPlan, withSubdecks } from '../src/data/decktrash';
import { applyReview, DEFAULT_PARAMS, scheduler } from '../src/srs/engine';
import { stateOf } from '../src/srs/queue';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { walk } from '../src/vault/util';

const NOW = Date.parse('2026-03-10T10:00:00-06:00');
const deck = (name: string, n: number, pre: string) => `---\ndeck: ${name}\n---\n` + Array.from({ length: n }, (_, i) => `Q:: ${pre}${i}\nA:: r ^${pre}${i}`).join('\n\n') + '\n';

async function setup() {
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/Cardio.md', deck('Cardio', 3, 'c'));
  await v.write('decks/Cardio/ECG.md', deck('ECG', 2, 'e'));
  await v.write('decks/Neuro.md', deck('Neuro', 2, 'n'));
  let col = await loadCollection(v, DEFAULT_PARAMS, NOW);
  const f = scheduler(DEFAULT_PARAMS);
  let t = NOW;
  for (const cid of ['c0', 'c1', 'e0', 'n0']) {
    const st = stateOf(col, cid);
    col.states.set(cid, st);
    await appendLog(v, col, [applyReview(f, st, cid, 3, (t += 60_000), 3000)], DEFAULT_PARAMS);
  }
  col = await loadCollection(v, DEFAULT_PARAMS, t);
  return { v, col, t };
}

describe('papelera de mazos', () => {
  it('un mazo con submazos: cifras, mover a la papelera y restaurar íntegro', async () => {
    const { v, col, t } = await setup();
    const cardio = col.decks.find((d) => d.name === 'Cardio')!;
    const all = withSubdecks(col, cardio);
    expect(all.map((d) => d.path).sort()).toEqual(['decks/Cardio.md', 'decks/Cardio/ECG.md']);
    expect(trashPlan(col, all)).toEqual({ cards: 5, reviews: 3 });
    const before = JSON.stringify(col.states.get('c0')!.card);

    const e = await trashDecks(v, col, all, t);
    const after = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(after.decks.map((d) => d.name)).toEqual(['Neuro']);
    expect(after.archived.map((a) => a.cid)).toEqual(expect.arrayContaining(['c0', 'c1', 'e0']));
    expect((await listTrash(v))[0]).toMatchObject({ cards: 5, reviews: 3, decks: [{ path: 'decks/Cardio.md' }, { path: 'decks/Cardio/ECG.md' }] });

    await restoreTrash(v, e);
    const back = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(back.decks.map((d) => d.name).sort()).toEqual(['Cardio', 'ECG', 'Neuro']);
    expect(JSON.stringify(back.states.get('c0')!.card)).toBe(before); // el historial vuelve con el mazo
    expect(back.archived.length).toBe(0);
    expect(await listTrash(v)).toEqual([]);
  });

  it('restaurar sin pisar un mazo nuevo con el mismo nombre', async () => {
    const { v, col, t } = await setup();
    const e = await trashDecks(v, col, [col.decks.find((d) => d.name === 'Neuro')!], t);
    await v.write('decks/Neuro.md', deck('Neuro nuevo', 1, 'x'));
    expect(await restoreTrash(v, e)).toEqual(['decks/Neuro (2).md']);
    expect(await v.exists('decks/Neuro.md')).toBe(true);
  });

  it('eliminar definitivamente y vaciado automático a los N días', async () => {
    const { v, col, t } = await setup();
    const a = await trashDecks(v, col, [col.decks.find((d) => d.name === 'Neuro')!], t - 40 * 86_400_000);
    await trashDecks(v, col, [col.decks.find((d) => d.name === 'ECG')!], t);
    expect(await autoPurge(v, 0, t)).toBe(0); // 0 = nunca
    expect(await autoPurge(v, 30, t)).toBe(1);
    expect((await listTrash(v)).map((x) => x.decks[0]!.name)).toEqual(['Cardio/ECG']);
    expect(await v.exists(`${DECK_TRASH}/${a.id}`)).toBe(false);
    await purgeTrash(v, (await listTrash(v))[0]!);
    expect(await walk(v, DECK_TRASH)).toEqual([]);
    // el historial no se tocó: reviews.jsonl sigue con sus 4 repasos
    expect((await v.read('.app/reviews.jsonl')).length).toBeGreaterThan(0);
  });
});
