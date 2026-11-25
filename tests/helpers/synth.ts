/** Colección sintética S/M/L (misma forma que `scripts/vault-gen.mjs`) sin pasar por la bóveda: para medir analítica. */
import { State } from 'ts-fsrs';
import type { Collection, Deck } from '../../src/data/collection';
import { newState, type LogEntry, type Rating } from '../../src/srs/engine';

export const SIZES = { S: { cards: 500, decks: 10 }, M: { cards: 5000, decks: 40 }, L: { cards: 20000, decks: 100 } } as const;
const DAY = 86_400_000;
const MATERIAS = ['Cardio', 'Neumo', 'Nefro', 'Farma', 'Anato', 'Fisio', 'Pedia', 'Neuro', 'Infecto', 'Endo'];

export function synth(size: keyof typeof SIZES, now: number): Collection {
  let a = 20261113;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const { cards, decks: nd } = SIZES[size];
  const decks: Deck[] = [];
  const byCid: Collection['byCid'] = new Map();
  const states: Collection['states'] = new Map();
  const log: LogEntry[] = [];
  for (let i = 0; i < nd; i++) {
    const full = `${MATERIAS[i % 10]}/Tema ${Math.floor(i / 10)}/Mazo ${i}`;
    const d = { path: `decks/${full}.md`, name: `Mazo ${i}`, full, folder: MATERIAS[i % 10]!, data: {}, notes: [], cards: [], newPerDay: null, tags: [`t${i % 7}`], errors: [] } as unknown as Deck;
    decks.push(d);
  }
  for (let i = 0; i < cards; i++) {
    const d = decks[i % nd]!;
    const cid = `c${i.toString(36).padStart(5, '0')}`;
    const ref = { cid, note: { front: `P ${cid}`, back: 'R' }, ord: 0 } as never;
    d.cards.push(ref);
    byCid.set(cid, { ref, deck: d });
    const st = newState(now);
    if (r() < 0.8) {
      const n = 1 + Math.floor(r() * 8);
      let ts = now - (n * 5 + Math.floor(r() * 40)) * DAY;
      let stab = 1;
      for (let k = 0; k < n; k++) {
        ts += Math.round(stab * DAY);
        const rating = (r() < 0.12 ? 1 : r() < 0.2 ? 2 : r() < 0.85 ? 3 : 4) as Rating;
        stab = rating === 1 ? 1 : stab * 2;
        log.push({ id: cid, ts, rating, ms: 5000, state: k ? State.Review : State.New });
        st.history.push({ ts, rating, ms: 5000 });
        if (ts > now) break;
      }
      st.card.state = State.Review;
      st.card.stability = stab;
      st.card.last_review = new Date(ts);
      st.card.due = new Date(ts + stab * DAY);
      st.history = st.history.slice(-10);
    }
    states.set(cid, st);
  }
  log.sort((x, y) => x.ts - y.ts);
  return { decks, byCid, states, log, badLines: 0, archived: [], idsAdded: 0 } as Collection;
}
