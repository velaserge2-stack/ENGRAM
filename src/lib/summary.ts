/**
 * Resumen de la bóveda para Hoy y Mazos. Todo se calcula desde los archivos;
 * nada se guarda duplicado (SPEC §9b).
 * Fase 1: el conteo de tarjetas es PRELIMINAR (por prefijo de línea). En la fase 2
 * lo sustituye el parser real con IDs de bloque y estado FSRS.
 */
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';
import { dayKey } from './days';
import { parseFrontmatter } from './frontmatter';

export const REVIEWS_PATH = '.app/reviews.jsonl';
export const MAX_MS_PER_CARD = 60_000;

export interface Review {
  id: string;
  ts: number;
  rating: number;
  ms: number;
}

export interface DeckSummary {
  path: string;
  name: string;
  color: string | null;
  cards: number;
  folder: string;
}

const CARD_LINE = /^(QR|Q|T|LO|L|MC|MATCH|ORD)::|^(Cloze|IO):/;

export function roughCardCount(body: string): number {
  let n = 0;
  for (const line of body.split(/\r?\n/)) {
    const m = CARD_LINE.exec(line.trimStart());
    if (!m) continue;
    if (m[1] === 'QR') n += 2;
    else if (m[2] === 'Cloze') n += Math.max(1, new Set([...line.matchAll(/\{\{c(\d+)::/g)].map((x) => x[1])).size);
    else n += 1;
  }
  return n;
}

export async function deckSummaries(vault: VaultAdapter): Promise<DeckSummary[]> {
  const files = (await walk(vault, 'decks')).filter((f) => f.path.endsWith('.md'));
  const out: DeckSummary[] = [];
  for (const f of files) {
    const doc = parseFrontmatter(await readTextOr(vault, f.path, ''));
    const rel = f.path.slice('decks/'.length, -3);
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    out.push({
      path: f.path,
      name: typeof doc.data.deck === 'string' ? doc.data.deck : rel.split('/').pop()!,
      color: typeof doc.data.color === 'string' ? doc.data.color : null,
      cards: roughCardCount(doc.body),
      folder,
    });
  }
  return out;
}

export function parseReviews(text: string): Review[] {
  const out: Review[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Partial<Review>;
      if (typeof r.ts === 'number' && typeof r.rating === 'number') {
        out.push({ id: String(r.id ?? ''), ts: r.ts, rating: r.rating, ms: Math.min(MAX_MS_PER_CARD, Math.max(0, Number(r.ms) || 0)) });
      }
    } catch {
      /* línea dañada: integridad la reporta */
    }
  }
  return out;
}

export interface DayActivity {
  cards: number;
  ms: number;
}

export function activityByDay(reviews: Review[], tz: string, dayStartHour: number): Map<string, DayActivity> {
  const m = new Map<string, DayActivity>();
  for (const r of reviews) {
    const k = dayKey(r.ts, tz, dayStartHour);
    const a = m.get(k) ?? { cards: 0, ms: 0 };
    a.cards++;
    a.ms += r.ms;
    m.set(k, a);
  }
  return m;
}

export async function loadReviews(vault: VaultAdapter): Promise<Review[]> {
  return parseReviews(await readTextOr(vault, REVIEWS_PATH, ''));
}
