/**
 * Consultas del navegador avanzado (SPEC §9 add-on 6):
 *   tag:ecg  deck:Cardio  due:<3  due:>10  is:new|learn|review|due|suspended|leech|buried
 *   type:cloze  origen:ia  lapses:>2  id:c01a  "frase exacta"  -excluir  texto libre
 */
import { normalizeAnswer } from '../cards/parse';
import type { Collection } from '../data/collection';
import { plainText } from '../md/render';
import { newState, State } from '../srs/engine';

export interface Row {
  cid: string;
  front: string;
  deck: string;
  type: string;
  state: number;
  due: number;
  lapses: number;
  reps: number;
  stability: number;
  difficulty: number;
  suspended: boolean;
  tags: string[];
}

type Pred = (r: Row, now: number) => boolean;

function tokens(q: string): string[] {
  return [...q.matchAll(/-?\w+:"[^"]*"|-?"[^"]*"|\S+/g)].map((m) => m[0]);
}

function cmp(spec: string, v: number): boolean {
  const m = /^(<=|>=|<|>|=)?(-?\d+(?:\.\d+)?)$/.exec(spec);
  if (!m) return false;
  const n = Number(m[2]);
  switch (m[1]) {
    case '<': return v < n;
    case '>': return v > n;
    case '<=': return v <= n;
    case '>=': return v >= n;
    default: return v === n;
  }
}

const norm = (s: string) => normalizeAnswer(s);

export function compile(q: string, leech = 8): Pred {
  const preds: Pred[] = [];
  for (let t of tokens(q)) {
    const neg = t.startsWith('-') && t.length > 1;
    if (neg) t = t.slice(1);
    const m = /^(\w+):(.*)$/.exec(t);
    let p: Pred;
    if (m) {
      const key = m[1]!.toLowerCase();
      const val = m[2]!.replace(/^"|"$/g, '');
      const nv = norm(val);
      switch (key) {
        case 'tag': p = (r) => r.tags.some((x) => norm(x) === nv || norm(x).startsWith(nv + ' ')); break;
        case 'deck': p = (r) => norm(r.deck).startsWith(nv) || norm(r.deck).includes(' ' + nv) || norm(r.deck).includes(nv); break;
        case 'due': p = (r, now) => r.state !== State.New && cmp(val, (r.due - now) / 86_400_000); break;
        case 'lapses': p = (r) => cmp(val, r.lapses); break;
        case 'reps': p = (r) => cmp(val, r.reps); break;
        case 'type': p = (r) => r.type === val; break;
        case 'id': p = (r) => r.cid === val || r.cid.startsWith(val + ':'); break;
        case 'origen': p = (r) => r.tags.includes(`origen/${val}`); break;
        case 'is':
          p = {
            new: (r: Row) => r.state === State.New,
            learn: (r: Row) => r.state === State.Learning || r.state === State.Relearning,
            review: (r: Row) => r.state === State.Review,
            due: (r: Row, now: number) => r.state !== State.New && r.due <= now,
            suspended: (r: Row) => r.suspended,
            leech: (r: Row) => r.lapses >= leech,
          }[val] ?? (() => false);
          break;
        default: p = (r) => norm(r.front).includes(norm(t));
      }
    } else {
      const w = norm(t.replace(/^"|"$/g, ''));
      p = (r) => norm(r.front).includes(w);
    }
    preds.push(neg ? (r, n) => !p(r, n) : p);
  }
  return (r, now) => preds.every((p) => p(r, now));
}

export function rows(col: Collection): Row[] {
  const out: Row[] = [];
  for (const [cid, { ref, deck }] of col.byCid) {
    const st = col.states.get(cid) ?? newState();
    out.push({
      cid,
      front: plainText(ref.note.front || ref.note.back),
      deck: deck.full,
      type: ref.note.type,
      state: st.card.state,
      due: st.card.due.getTime(),
      lapses: st.card.lapses,
      reps: st.card.reps,
      stability: st.card.stability,
      difficulty: st.card.difficulty,
      suspended: st.suspended,
      tags: [...deck.tags, ...(ref.note.origin === 'ia' ? ['origen/ia'] : [])],
    });
  }
  return out;
}

export function search(col: Collection, q: string, now = Date.now(), leech = 8): Row[] {
  const p = compile(q, leech);
  return rows(col).filter((r) => p(r, now));
}
