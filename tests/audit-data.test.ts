/**
 * Auditoría etapa 2.2 · src/cards, src/srs, src/data. Cada `it.fails` demuestra un error que EXISTE hoy:
 * la suite sigue en verde mientras el error exista. auditoría: cambiar a it() al corregir.
 */
import { describe, expect, it } from 'vitest';
import { checkTyped, ensureIds, parseDeck } from '../src/cards/parse';
import { appendLog, ARCHIVE, loadCollection, REVIEWS } from '../src/data/collection';
import { deleteAttempt, ATTEMPTS, loadExtra, restoreAttempt } from '../src/data/extra';
import { appendCard, setDeckMeta, stateOp } from '../src/data/ops';
import { withSubdecks } from '../src/data/decktrash';
import { DEFAULT_PARAMS, type LogEntry } from '../src/srs/engine';
import { buildQueue, newIntroducedToday, reviewsToday, type StudyLimits } from '../src/srs/queue';
import { MemoryBackend } from '../src/vault/memory';
import { readText } from '../src/vault/util';

class Flaky extends MemoryBackend {
  failRead: string | null = null;
  failWrite: string | null = null;
  override async read(p: string) { if (this.failRead === p) throw new Error('lectura transitoria'); return super.read(p); }
  override async write(p: string, d: Uint8Array | string) { if (this.failWrite === p) throw new Error('escritura fallida'); return super.write(p, d); }
}
const LIM: StudyLimits = { newPerDay: 20, reviewLimit: 200, recoveryThreshold: 100, leechThreshold: 8, tz: 'UTC', dayStartHour: 4 };
const NOW = Date.UTC(2026, 10, 12, 12);
const P = DEFAULT_PARAMS;
const rev = (id: string, ts: number, state = 0): LogEntry => ({ id, ts, rating: 3, ms: 1000, state });

describe('auditoría · parser', () => {
  // auditoría: corregido (menores)
  it('un texto que acaba en « ^10» (potencia) no se toma por ID de tarjeta', () => {
    expect(parseDeck('Q:: x\nA:: 2 ^10\n').notes[0]!.id).toBe('');
  });
  // auditoría: corregido (menores)
  it('ensureIds conserva los saltos CRLF del archivo del usuario', () => {
    const r = ensureIds('---\r\ndeck: X\r\n---\r\nQ:: a\r\nA:: b\r\n\r\nQ:: c\r\nA:: d ^zz9\r\n');
    expect(r.text).not.toMatch(/(^|[^\r])\n/);
  });
  // auditoría: corregido (menores)
  it('oclusión: un rectángulo con campo vacío (10,20,,40) no se acepta como w=0', () => {
    const n = parseDeck('IO: ![[a.png]] <!-- io: 10,20,,40 --> ^abcd\n').notes[0]!;
    expect(n.rects).toHaveLength(0);
  });
  // auditoría: corregido (menores)
  it('escribir respuesta: « 2» frente a «1» no es «casi correcto»', () => {
    expect(checkTyped('2', '1')).toBe('wrong');
  });
  // auditoría: corregido (menores)
  it('escribir respuesta: una respuesta solo de símbolos («+») idéntica es correcta', () => {
    expect(checkTyped('+', '+')).toBe('correct');
  });
});

describe('auditoría · cola', () => {
  const lines = (...e: LogEntry[]) => e;
  const col = (log: LogEntry[]) => ({ log, byCid: new Map([['aaa', { deck: { path: 'decks/A.md' } }]]) }) as never;
  // auditoría: corregido (menores)
  it('deshacer la primera respuesta de una tarjeta nueva devuelve el cupo de nuevas del día', () => {
    const log = lines(rev('aaa', NOW - 1000, 0), { id: 'aaa', ts: NOW - 500, op: 'undo', ref: NOW - 1000 });
    expect(newIntroducedToday(col(log), NOW, LIM).get('decks/A.md') ?? 0).toBe(0);
  });
  // auditoría: corregido (menores)
  it('deshacer un repaso lo quita del contador de repasos de hoy', () => {
    const log = lines(rev('aaa', NOW - 1000, 2), { id: 'aaa', ts: NOW - 500, op: 'undo', ref: NOW - 1000 });
    expect(reviewsToday(col(log), NOW, LIM)).toBe(0);
  });
  // auditoría: corregido (plan 8)
  it('un ID repetido en dos mazos no mete la misma tarjeta dos veces en la cola', async () => {
    const v = new MemoryBackend();
    await v.write('decks/A.md', '---\ndeck: A\n---\nQ:: p\nA:: r ^dup01\n');
    await v.write('decks/B.md', '---\ndeck: B\n---\nQ:: p\nA:: r ^dup01\n');
    const c = await loadCollection(v, P, NOW);
    const q = buildQueue(c, null, NOW, LIM, P);
    expect(q.fresh).toHaveLength(1);
    expect(c.decks.find((d) => d.name === 'B')!.errors.join(' ')).toContain('dup01'); // se avisa
  });
  it('plan 8: appendCard no reutiliza un ID del historial (tarjeta archivada)', async () => {
    const v = new MemoryBackend();
    await v.write(REVIEWS, JSON.stringify(rev('aaaaa', 1)) + '\n');
    await v.write('decks/A.md', 'Q:: x\nA:: y ^bbbbb\n');
    const c = await loadCollection(v, P, NOW);
    const r = Math.random;
    let first = true;
    Math.random = () => (first ? ((first = false), (17_276_050 + 0.5) / 36 ** 5) : r()); // «aaaaa»
    try { expect(await appendCard(v, 'decks/A.md', 'Q:: z\nA:: w', c)).not.toBe('aaaaa'); } finally { Math.random = r; }
  });
});

describe('auditoría · datos (lecturas fallidas y carreras)', () => {
  // auditoría: corregido (plan 1 y 5). Con lectura estricta appendLog rechaza y no escribe: el archivo conserva
  // sus 2 líneas (antes quedaba solo «ccc»). La aserción original (3 líneas) exigía añadir sin poder leer.
  it('appendLog no sustituye reviews.jsonl si la lectura falla', async () => {
    const v = new Flaky();
    const c = await loadCollection(v, P, NOW);
    await v.write(REVIEWS, `${JSON.stringify(rev('aaa', 1))}\n${JSON.stringify(rev('bbb', 2))}\n`);
    v.failRead = REVIEWS;
    await expect(appendLog(v, c, [rev('ccc', 3)], P)).rejects.toThrow('lectura transitoria');
    v.failRead = null;
    expect((await readText(v, REVIEWS)).trim().split('\n').map((l) => (JSON.parse(l) as LogEntry).id)).toEqual(['aaa', 'bbb']);
    await appendLog(v, c, [rev('ccc', 3)], P); // al reintentar, se añade sin perder nada
    expect((await readText(v, REVIEWS)).trim().split('\n')).toHaveLength(3);
  });
  // auditoría: corregido (plan 5)
  it('dos appendLog simultáneos no pierden entradas (leer-modificar-escribir sin cola)', async () => {
    const v = new MemoryBackend();
    const c = await loadCollection(v, P, NOW);
    await Promise.all([appendLog(v, c, [rev('aaa', 1)], P), appendLog(v, c, [rev('bbb', 2)], P)]);
    expect((await readText(v, REVIEWS)).trim().split('\n')).toHaveLength(2);
  });
  // auditoría: corregido (plan 1)
  it('appendCard no reemplaza el mazo por una sola tarjeta si la lectura falla', async () => {
    const v = new Flaky();
    await v.write('decks/A.md', '---\ndeck: A\n---\nQ:: uno\nA:: dos ^aaa11\n');
    v.failRead = 'decks/A.md';
    await appendCard(v, 'decks/A.md', 'Q:: x\nA:: y', null).catch(() => undefined);
    v.failRead = null;
    expect(await readText(v, 'decks/A.md')).toContain('aaa11');
  });
  // auditoría: corregido (plan 1)
  it('setDeckMeta no deja el mazo sin tarjetas si la lectura falla', async () => {
    const v = new Flaky();
    await v.write('decks/A.md', '---\ndeck: A\n---\nQ:: uno\nA:: dos ^aaa11\n');
    v.failRead = 'decks/A.md';
    await setDeckMeta(v, 'decks/A.md', { color: 'rojo' }).catch(() => undefined);
    v.failRead = null;
    expect(await readText(v, 'decks/A.md')).toContain('aaa11');
  });
  // auditoría: corregido (plan 1)
  it('restoreAttempt (deshacer borrar intento) no sustituye el archivo si la lectura falla', async () => {
    const v = new Flaky();
    const a = (id: string) => JSON.stringify({ id, finishedAt: 1 });
    await v.write(ATTEMPTS, [a('1'), a('2'), a('3'), a('4')].join('\n') + '\n');
    const removed = (await deleteAttempt(v, '3'))!;
    v.failRead = ATTEMPTS;
    await restoreAttempt(v, removed).catch(() => undefined);
    v.failRead = null;
    expect((await readText(v, ATTEMPTS)).split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });
  // auditoría: corregido (plan 8)
  it('un mazo ilegible al cargar no archiva sus tarjetas con historial', async () => {
    const v = new Flaky();
    await v.write('decks/A.md', '---\ndeck: A\n---\nQ:: uno\nA:: dos ^aaa11\n');
    await v.write('decks/B.md', '---\ndeck: B\n---\nQ:: tres\nA:: cuatro ^bbb22\n');
    await v.write(REVIEWS, JSON.stringify(rev('aaa11', 1)) + '\n');
    v.failRead = 'decks/A.md';
    const c = await loadCollection(v, P, NOW);
    v.failRead = null;
    expect(JSON.parse(await readText(v, ARCHIVE).catch(() => '{}'))).toEqual({});
    // el resto se carga, el ilegible se avisa y conserva su estado
    expect(c.decks.map((d) => d.name)).toEqual(['B']);
    expect(c.unreadable).toEqual(['decks/A.md']);
    expect(c.states.has('aaa11')).toBe(true);
    expect(await readText(v, 'decks/A.md')).toBe('---\ndeck: A\n---\nQ:: uno\nA:: dos ^aaa11\n');
  });
  // auditoría: corregido (menores)
  it('stateOp no deja el estado en memoria cambiado si falla la escritura del historial', async () => {
    const v = new Flaky();
    await v.write('decks/A.md', '---\ndeck: A\n---\nQ:: uno\nA:: dos ^aaa11\n');
    const c = await loadCollection(v, P, NOW);
    v.failWrite = REVIEWS;
    await stateOp(v, c, ['aaa11'], 'suspend', P).catch(() => undefined);
    expect(c.states.get('aaa11')?.suspended ?? false).toBe(false);
  });
  // auditoría: corregido (menores)
  it('loadExtra ignora tiempos de examen negativos o no numéricos', async () => {
    const v = new MemoryBackend();
    await v.write(ATTEMPTS, `${JSON.stringify({ id: 'a', finishedAt: 5, elapsedMs: -9000 })}\n${JSON.stringify({ id: 'b', finishedAt: 6, elapsedMs: 'x' })}\n`);
    const { exams } = await loadExtra(v);
    expect(exams.every((e) => Number.isFinite(e.ms) && e.ms >= 0)).toBe(true);
  });
});

describe('auditoría · papelera', () => {
  // auditoría: corregido (menores)
  it('withSubdecks encuentra los submazos de un mazo cuyo nombre (deck:) difiere del archivo', async () => {
    const v = new MemoryBackend();
    await v.write('decks/Anatomía tórax.md', '---\ndeck: "Anatomía: tórax"\n---\nQ:: a\nA:: b ^aaa11\n');
    await v.write('decks/Anatomía tórax/Pleura.md', '---\ndeck: Pleura\n---\nQ:: c\nA:: d ^bbb22\n');
    const c = await loadCollection(v, P, NOW);
    const parent = c.decks.find((d) => d.name === 'Anatomía: tórax')!;
    expect(withSubdecks(c, parent)).toHaveLength(2);
  });
});
