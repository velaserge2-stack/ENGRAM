import { describe, expect, it } from 'vitest';
import { appendLog, loadCollection, verifyDeterminism } from '../src/data/collection';
import { canMoveTo, moveCards, moveDeck, moveDecks, undoMove } from '../src/data/move';
import { fromICS, toICS } from '../src/lib/ics';
import { applyReview, DEFAULT_PARAMS, scheduler } from '../src/srs/engine';
import { stateOf } from '../src/srs/queue';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { readTextOr, walk } from '../src/vault/util';

const NOW = Date.parse('2026-03-10T10:00:00-06:00');
const deck = (name: string, n: number, pre: string, extra = '') => `---\ndeck: ${name}\n${extra}---\n` + Array.from({ length: n }, (_, i) => `Q:: ${pre}${i}\nA:: r ^${pre}${i}`).join('\n\n') + '\n';

async function setup() {
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/Cardiología.md', deck('Cardiología', 2, 'c'));
  await v.write('decks/Cardiología/ECG.md', deck('ECG', 2, 'e', 'color: "#aa0000"\nnew_per_day: 7\nid: k3x\n'));
  await v.write('decks/Cardiología/ECG/Arritmias.md', deck('Arritmias', 1, 'a'));
  await v.write('decks/Urgencias.md', deck('Urgencias', 1, 'u'));
  await v.write('exams/Parcial.md', '---\nexamen: Parcial\nfecha: 2026-04-01\ntemas: [Cardiología/ECG, tag:ecg, Urgencias]\n---\n');
  await v.write('calendar/estudio.ics', toICS([{ uid: 'b1', start: NOW, end: NOW + 3600_000, title: 'ECG', subject: '', note: '', rrule: '', until: '', done: [], alarmMin: null, floating: true, links: ['engrama://topic/Cardiolog%C3%ADa%2FECG', 'engrama://deck/k3x'] }]));
  let col = await loadCollection(v, DEFAULT_PARAMS, NOW);
  const f = scheduler(DEFAULT_PARAMS);
  let t = NOW;
  for (const cid of ['e0', 'e1', 'a0', 'c0']) {
    const st = stateOf(col, cid);
    col.states.set(cid, st);
    await appendLog(v, col, [applyReview(f, st, cid, 3, (t += 60_000), 3000)], DEFAULT_PARAMS);
  }
  col = await loadCollection(v, DEFAULT_PARAMS, t);
  return { v, col, t };
}
const snap = (col: Awaited<ReturnType<typeof loadCollection>>) => JSON.stringify([...col.states.entries()].sort().map(([k, s]) => [k, s.card]));

describe('mover mazos (Prompt 6 · A1)', () => {
  it('Cardiología/ECG → Urgencias: conserva historial, estado, frontmatter, submazos, calendario y exámenes', async () => {
    const { v, col, t } = await setup();
    const before = snap(col);
    const ecg = col.decks.find((d) => d.full === 'Cardiología/ECG')!;
    expect(canMoveTo(ecg, 'Cardiología/ECG/Arritmias')).toBe(false);
    const undo = await moveDeck(v, col, ecg, 'Urgencias');
    const after = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(after.decks.map((d) => d.full).sort()).toEqual(['Cardiología', 'Urgencias', 'Urgencias/ECG', 'Urgencias/ECG/Arritmias']);
    const moved = after.decks.find((d) => d.full === 'Urgencias/ECG')!;
    expect(moved.data).toMatchObject({ color: '#aa0000', new_per_day: 7, id: 'k3x' });
    expect(snap(after)).toBe(before);
    expect(verifyDeterminism(after, DEFAULT_PARAMS).ok).toBe(true);
    expect(after.archived).toEqual([]);
    expect(await readTextOr(v, 'exams/Parcial.md', '')).toContain('Urgencias/ECG');
    const links = fromICS(await readTextOr(v, 'calendar/estudio.ics', ''))[0]!.links;
    expect(links).toEqual(['engrama://topic/Urgencias%2FECG', 'engrama://deck/k3x']);
    expect((await walk(v, 'decks')).some((f) => f.path.startsWith('decks/Cardiología/ECG'))).toBe(false);

    await undoMove(v, undo);
    const back = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(back.decks.map((d) => d.full).sort()).toEqual(['Cardiología', 'Cardiología/ECG', 'Cardiología/ECG/Arritmias', 'Urgencias']);
    expect(await readTextOr(v, 'exams/Parcial.md', '')).toContain('Cardiología/ECG');
    expect(snap(back)).toBe(before);
  });

  it('duplicado: renombrar como «(2)» o fusionar', async () => {
    const { v, col, t } = await setup();
    await v.write('decks/ECG.md', deck('ECG', 1, 'x'));
    let c = await loadCollection(v, DEFAULT_PARAMS, t);
    await moveDeck(v, c, c.decks.find((d) => d.full === 'Cardiología/ECG')!, '', 'rename');
    c = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(c.decks.map((d) => d.full).sort()).toEqual(['Cardiología', 'ECG', 'ECG (2)', 'ECG (2)/Arritmias', 'Urgencias']);

    const { v: v2, t: t2 } = await setup();
    await v2.write('decks/ECG.md', deck('ECG', 1, 'x'));
    c = await loadCollection(v2, DEFAULT_PARAMS, t2);
    const before = snap(c);
    await moveDeck(v2, c, c.decks.find((d) => d.full === 'Cardiología/ECG')!, '', 'merge');
    c = await loadCollection(v2, DEFAULT_PARAMS, t2);
    expect(c.decks.map((d) => d.full).sort()).toEqual(['Cardiología', 'ECG', 'ECG/Arritmias', 'Urgencias']);
    expect(c.decks.find((d) => d.full === 'ECG')!.cards.map((x) => x.cid).sort()).toEqual(['e0', 'e1', 'x0']);
    expect(snap(c)).toBe(before);
    void col;
  });

  it('varios a la vez: el submazo seleccionado viaja con su padre', async () => {
    const { v, col, t } = await setup();
    await moveDecks(v, col, col.decks.filter((d) => d.full.startsWith('Cardiología/ECG')), 'Urgencias');
    const c = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(c.decks.map((d) => d.full).sort()).toEqual(['Cardiología', 'Urgencias', 'Urgencias/ECG', 'Urgencias/ECG/Arritmias']);
  });
});

describe('mover tarjetas', () => {
  it('conserva el ID y el historial; choque de ID: omitir o duplicar', async () => {
    const { v, col, t } = await setup();
    const before = snap(col);
    const urg = col.decks.find((d) => d.full === 'Urgencias')!;
    const r = await moveCards(v, col, ['e0', 'c0'], urg);
    expect(r).toMatchObject({ moved: 2, skipped: 0 });
    let c = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(c.byCid.get('e0')!.deck.full).toBe('Urgencias');
    expect(c.byCid.get('c0')!.deck.full).toBe('Urgencias');
    expect(c.decks.find((d) => d.full === 'Cardiología/ECG')!.cards.map((x) => x.cid)).toEqual(['e1']);
    expect(snap(c)).toBe(before);
    expect(verifyDeterminism(c, DEFAULT_PARAMS).ok).toBe(true);

    await undoMove(v, r.undo);
    c = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(c.byCid.get('e0')!.deck.full).toBe('Cardiología/ECG');

    // choque: el destino ya tiene una nota ^e1
    await v.write('decks/Urgencias.md', (await readTextOr(v, 'decks/Urgencias.md', '')) + '\nQ:: copia\nA:: r ^e1\n');
    const c2 = await loadCollection(v, DEFAULT_PARAMS, t);
    const target = c2.decks.find((d) => d.full === 'Urgencias')!;
    expect(await moveCards(v, c2, ['e1'], target, 'skip')).toMatchObject({ moved: 0, skipped: 1 });
    const d = await moveCards(v, c2, ['e1'], target, 'duplicate');
    expect(d).toMatchObject({ moved: 0, duplicated: 1 });
    const c3 = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(c3.decks.find((x) => x.full === 'Urgencias')!.cards.length).toBe(3);
  });
});

describe('mover carpetas', () => {
  it('una carpeta sin mazo propio viaja con todo lo de dentro', async () => {
    const { v, col, t } = await setup();
    await v.remove('decks/Cardiología.md');
    const c0 = await loadCollection(v, DEFAULT_PARAMS, t);
    const { moveFolder } = await import('../src/data/move');
    await moveFolder(v, c0, 'Cardiología', 'Urgencias');
    const c = await loadCollection(v, DEFAULT_PARAMS, t);
    expect(c.decks.map((d) => d.full).sort()).toEqual(['Urgencias', 'Urgencias/Cardiología/ECG', 'Urgencias/Cardiología/ECG/Arritmias']);
    expect(await readTextOr(v, 'exams/Parcial.md', '')).toContain('Urgencias/Cardiología/ECG');
    void col;
  });
});
