/**
 * Auditoría etapa 3 · críticos (determinismo FSRS, SafeVault, NoteStore, mover, importadores, calendario).
 * Cada `it.fails` demuestra un error que EXISTE hoy: la suite sigue en verde mientras el error exista.
 * auditoría: cambiar a it() al corregir. Los `it` normales son controles (comportamiento correcto, descartado).
 */
process.env.TZ = 'America/Mexico_City';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDeck } from '../src/cards/parse';
import { loadCollection, loadStates, REVIEWS, STATE } from '../src/data/collection';
import { moveCards } from '../src/data/move';
import { convertApkg, type SqlJs } from '../src/io/apkg';
import { parseZip } from '../src/io/zip';
import { LIMITS } from '../src/io/limits';
import { fromICS, occurrences } from '../src/lib/ics';
import { noteStore } from '../src/notes/store';
import { applyReview, DEFAULT_PARAMS, newState, parseLog, replay, scheduler } from '../src/srs/engine';
import { MemoryBackend } from '../src/vault/memory';
import { normalizePath } from '../src/vault/paths';
import { JOURNAL_PATH, SafeVault } from '../src/vault/safe';
import { VaultError } from '../src/vault/types';
import { checksum, readText } from '../src/vault/util';

const P = DEFAULT_PARAMS;
const T = Date.UTC(2026, 0, 10, 15);
const DAY = 86_400_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Backend con fallos y compuertas para simular cortes y carreras. */
class Rig extends MemoryBackend {
  failRead: string | null = null;
  failWrite: string | null = null;
  /** OPFS con sync handle: `truncate(0)` y luego falla (cuota, Worker reiniciado…) */
  truncateThenFail: string | null = null;
  gate: { path: string; open: Promise<void>; reached: boolean } | null = null;
  override async read(p: string) {
    if (this.failRead === p) { this.failRead = null; throw new VaultError('lectura transitoria', 'io', p); }
    return super.read(p);
  }
  override async write(p: string, d: Uint8Array | string) {
    if (this.failWrite === p) throw new VaultError('sin espacio', 'quota', p);
    if (this.truncateThenFail === p) { this.truncateThenFail = null; await super.write(p, new Uint8Array()); throw new VaultError('sin espacio', 'quota', p); }
    if (this.gate?.path === p) { this.gate.reached = true; await this.gate.open; }
    return super.write(p, d);
  }
}
function gated(r: Rig, path: string) {
  let release!: () => void;
  r.gate = { path, open: new Promise<void>((res) => (release = res)), reached: false };
  return { release: () => { release(); r.gate = null; }, reached: async () => { for (let i = 0; i < 50 && !r.gate?.reached; i++) await tick(); } };
}
afterEach(() => vi.restoreAllMocks());

// ───────────────────────── 1 · determinismo FSRS ─────────────────────────
describe('auditoría · determinismo FSRS', () => {
  // auditoría: corregido (plan 6)
  it('una línea con ts fuera de rango (1e400, -1e20) no envenena la tarjeta (estabilidad NaN para siempre)', () => {
    const text = [`{"id":"c","ts":${T},"rating":3}`, '{"id":"c","ts":1e400,"rating":3}', `{"id":"c","ts":${T + 3 * DAY},"rating":3}`].join('\n');
    const st = replay(parseLog(text).entries, P).get('c')!;
    expect(Number.isFinite(st.card.stability)).toBe(true);
    expect(Number.isFinite(st.card.due.getTime())).toBe(true);
  });

  // auditoría: cambiar a it() al corregir
  it.fails('la caché state.json se invalida si cambia una línea intermedia de reviews.jsonl (misma longitud y misma última)', async () => {
    const v = new MemoryBackend();
    const lines = (r: number) => [`{"id":"a","ts":${T},"rating":3}`, `{"id":"b","ts":${T + 1},"rating":${r}}`, `{"id":"c","ts":${T + 2},"rating":3}`].join('\n') + '\n';
    await v.write(REVIEWS, lines(3));
    await loadStates(v, P); // escribe la caché
    await v.write(REVIEWS, lines(1)); // edición a mano / sincronización: «b» pasa de Bien a Otra vez
    const r = await loadStates(v, P);
    expect(JSON.stringify(r.states.get('b')!.card)).toBe(JSON.stringify(replay(r.log, P).get('b')!.card));
  });

  // auditoría: corregido (plan 1)
  it('loadStates no reconstruye ni sobrescribe state.json desde un historial vacío si la lectura de reviews.jsonl falla', async () => {
    const v = new Rig();
    await v.write(REVIEWS, `{"id":"a","ts":${T},"rating":3}\n`);
    await loadStates(v, P);
    v.failRead = REVIEWS;
    await expect(loadStates(v, P)).rejects.toBeTruthy();
  });

  // auditoría: corregido (plan 6)
  it('applyReview con el reloj atrasado (ts < último repaso) no lanza (si lanza, Estudio queda en busy)', () => {
    const f = scheduler(P);
    const st = newState();
    applyReview(f, st, 'x', 3, T + 5 * DAY, 1000);
    expect(() => applyReview(f, st, 'x', 3, T + 3 * DAY, 1000)).not.toThrow();
  });

  it('plan 6: con el reloj atrasado (también tras «olvidar») el estado en vivo == replay del historial escrito', () => {
    const f = scheduler(P);
    const st = newState();
    const es = [applyReview(f, st, 'x', 3, T + 5 * DAY, 1000), applyReview(f, st, 'x', 1, T + 3 * DAY, 1000)];
    expect(es[1]!.ts).toBe(T + 5 * DAY + 1); // distinto ts: deshacer uno no deshace el otro
    const forget = { id: 'x', ts: T + 6 * DAY, op: 'forget' as const };
    Object.assign(st, newState(forget.ts), { history: st.history });
    es.push(forget, applyReview(f, st, 'x', 4, T + 2 * DAY, 1000));
    expect(JSON.stringify(replay(es, P).get('x')!.card)).toBe(JSON.stringify(st.card));
  });

  it('plan 6: parseLog descarta op desconocida, entradas sin calificación ni op y calificación con op', () => {
    const r = parseLog([`{"id":"a","ts":${T},"rating":3}`, `{"id":"zz","ts":5}`, `{"id":"a","ts":${T},"op":"borrar"}`, `{"id":"a","ts":${T},"rating":3,"op":"undo"}`, `{"id":"a","ts":${T},"op":"undo","ref":${T}}`, `{"id":"a","ts":-1e20,"op":"suspend"}`].join('\n'));
    expect(r.entries).toHaveLength(2);
    expect(r.bad).toBe(4);
  });

  // auditoría: cambiar a it() al corregir
  it.fails('un ID nuevo no reutiliza el de una tarjeta archivada o en la papelera (heredaría su historial FSRS)', async () => {
    const v = new MemoryBackend();
    await v.write(REVIEWS, `{"id":"aaaaa","ts":${T},"rating":3}\n{"id":"aaaaa","ts":${T + 3 * DAY},"rating":3}\n`);
    await v.write('decks/Nuevo.md', 'Q:: tarjeta recién escrita\nA:: sin historial\n');
    // newId: floor(r · 36^5) en base 36; este r produce «aaaaa» (17 276 050)
    vi.spyOn(Math, 'random').mockReturnValueOnce((17_276_050 + 0.5) / 36 ** 5);
    const col = await loadCollection(v, P, T + 10 * DAY);
    const cid = col.decks[0]!.cards[0]!.cid;
    expect(cid).not.toBe('aaaaa');
  });

  it('control: tarjeta nueva en vivo (newState() en 1970) y reproducida (newState(ts)) dan el mismo estado', () => {
    const f = scheduler(P);
    const st = newState();
    const es = [applyReview(f, st, 'a', 3, T, 1000), applyReview(f, st, 'a', 3, T + 600_000, 1000), applyReview(f, st, 'a', 1, T + 2 * DAY, 1000)];
    expect(JSON.stringify(replay(es, P).get('a')!.card)).toBe(JSON.stringify(st.card));
  });
});

// ───────────────────────── 2 · SafeVault y diario ─────────────────────────
describe('auditoría · SafeVault', () => {
  // auditoría: corregido (plan 2). Con el reintento la escritura puede cumplirse: basta que no rechace con pérdida
  it('un apply fallido (destino truncado) se recupera aunque después haya otra escritura', async () => {
    const raw = new Rig();
    const v = new SafeVault(raw);
    await v.write('notes/a.md', 'v1');
    raw.truncateThenFail = 'notes/a.md';
    await v.write('notes/a.md', 'v2').catch(() => undefined); // hoy: rechaza; con el plan 2, el reintento la completa
    await v.write('notes/b.md', 'otra'); // la app sigue: esta transacción pisa el diario de la anterior
    await new SafeVault(raw).recover(); // siguiente arranque
    expect(['v1', 'v2']).toContain(await readText(raw, 'notes/a.md'));
  });

  // auditoría: corregido (plan 3)
  it('recover no ejecuta un diario ajeno: tmp fuera de .app/tmp y `from` que es una carpeta', async () => {
    const raw = new MemoryBackend();
    await raw.write('decks/Cardio.md', 'Q:: a\nA:: b ^abcde\n');
    const payload = strToU8('x');
    await raw.write('notes/payload.md', payload);
    await raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [{ op: 'move', path: 'notes/y.md', from: 'decks', tmp: 'notes/payload.md', size: 1, hash: checksum(payload), ts: 0 }] }));
    await new SafeVault(raw).recover();
    expect(await raw.exists('decks/Cardio.md')).toBe(true);
  });

  // auditoría: corregido (plan 4). Con un solo escritor, A espera a B: ya no se puede esperar a A con B detenido,
  // así que A se lanza sin esperar y se comprueba que no toca el diario de B (ni escribe) hasta que B termina.
  it('dos pestañas: la transacción de una no borra el diario de la otra mientras su escritura sigue en curso', async () => {
    const raw = new Rig();
    const tabA = new SafeVault(raw), tabB = new SafeVault(raw);
    const g = gated(raw, 'notes/b.md');
    const pb = tabB.write('notes/b.md', 'B');
    await g.reached();
    let pa: Promise<void> | undefined;
    try {
      pa = tabA.write('notes/a.md', 'A');
      for (let i = 0; i < 20; i++) await tick();
      expect(await raw.exists(JOURNAL_PATH)).toBe(true); // si B muere ahora, nadie puede rehacer b.md
      expect(await raw.exists('notes/a.md')).toBe(false);
    } finally {
      g.release();
      await pb;
      await pa;
    }
    expect(await readText(raw, 'notes/a.md')).toBe('A');
  });

  it('control: un .app/journal.json importado por SafeVault.write se borra en la misma transacción (impacto de 02-notes-io #3 acotado a un corte en esa ventana)', async () => {
    const raw = new MemoryBackend();
    const v = new SafeVault(raw);
    await v.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [{ op: 'move', path: 'x.md', from: 'decks', tmp: 'notes/p.md', size: 1, hash: 'x', ts: 0 }] }));
    expect(await raw.exists(JOURNAL_PATH)).toBe(false);
  });
});

// ───────────────────────── 3 · NoteStore ─────────────────────────
describe('auditoría · NoteStore', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('refresh durante un guardado en curso no devuelve el documento al texto viejo del disco', async () => {
    const raw = new Rig();
    const v = new SafeVault(raw);
    const p = 'notes/carrera-refresh.md';
    await raw.write(p, 'A');
    await noteStore.load(v, p);
    const g = gated(raw, p);
    noteStore.set(v, p, 'A + lo tecleado');
    const saving = noteStore.flush(p); // `pending` ya es false: el guardado está en vuelo
    await g.reached();
    try {
      await noteStore.refresh(v, p); // otro panel / app.changed() en ese instante
      expect(noteStore.peek(p)).toBe('A + lo tecleado');
    } finally {
      g.release();
      await saving;
    }
  });

  // auditoría: cambiar a it() al corregir
  it.fails('forget con un panel aún suscrito: teclear después no resucita la nota en la ruta vieja', async () => {
    const v = new SafeVault(new MemoryBackend());
    const p = 'notes/se-mueve.md';
    await v.write(p, 'texto');
    await noteStore.load(v, p);
    const un = noteStore.subscribe(v, p, () => {}); // segundo panel abierto sobre la misma nota
    await noteStore.forget(p); // runNoteMove / papelera desde el otro panel
    await v.move(p, 'notes/Cardio/se-mueve.md');
    noteStore.set(v, p, 'texto + tecla en el panel viejo');
    await noteStore.flush(p);
    un();
    expect(await v.exists(p)).toBe(false);
  });
});

// ───────────────────────── 4 · mover ─────────────────────────
describe('auditoría · mover tarjetas', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('moveCards: si falla la escritura del destino, la tarjeta no desaparece de ambos archivos', async () => {
    const v = new Rig();
    await v.write('decks/A.md', 'Q:: tarjeta que se mueve\nA:: r ^mov01\n\nQ:: otra\nA:: r ^otr01\n');
    await v.write('decks/B.md', 'Q:: destino\nA:: r ^des01\n');
    const col = await loadCollection(v, P, T);
    const target = col.decks.find((d) => d.path === 'decks/B.md')!;
    v.failWrite = 'decks/B.md';
    await expect(moveCards(v, col, ['mov01'], target)).rejects.toBeTruthy();
    v.failWrite = null;
    const all = (await readText(v, 'decks/A.md')) + (await readText(v, 'decks/B.md'));
    expect(all).toContain('tarjeta que se mueve');
  });
});

// ───────────────────────── 5 · importadores hostiles ─────────────────────────
async function sql(): Promise<SqlJs> {
  const init = (await import('sql.js')).default as unknown as () => Promise<SqlJs>;
  return init();
}
async function apkg(fields: string[], deck: string): Promise<Uint8Array> {
  const SQL = await sql();
  const db = new SQL.Database() as unknown as { run(s: string, p?: unknown[]): void; export(): Uint8Array };
  db.run('CREATE TABLE col (id integer, models text, decks text)');
  db.run('CREATE TABLE notes (id integer, mid integer, flds text, tags text)');
  db.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer)');
  db.run('CREATE TABLE revlog (id integer, cid integer, ease integer, time integer, type integer)');
  db.run('INSERT INTO col VALUES (1, ?, ?)', [JSON.stringify({ 10: { type: 0, name: 'Básico' } }), JSON.stringify({ 5: { name: deck } })]);
  fields.forEach((f, i) => {
    db.run('INSERT INTO notes VALUES (?, 10, ?, ?)', [1000 + i, f, '']);
    db.run('INSERT INTO cards VALUES (?, ?, 5, 0)', [i + 1, 1000 + i]);
  });
  return zipSync({ 'collection.anki2': db.export(), media: strToU8('{}') });
}

describe('auditoría · importadores', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('apkg: un mazo llamado «..::X» no produce una ruta con «..» (buildPlan rechazaría TODO el lote)', async () => {
    const r = convertApkg(await apkg(['q\x1fa'], '..::X'), await sql());
    expect(() => normalizePath(r.decks[0]!.path)).not.toThrow();
  });

  // auditoría: cambiar a it() al corregir
  it.fails('apkg: un campo con una línea «Q:: …» no se convierte en otra tarjeta (ni se lleva el ID)', async () => {
    const r = convertApkg(await apkg(['pregunta\x1frespuesta<br>Q:: inyectada<br>A:: falsa'], 'Mazo'), await sql());
    expect(parseDeck(r.decks[0]!.text).notes).toHaveLength(1);
  });

  it('control: zip con cabecera que miente sobre el tamaño (bomba) se trunca a lo declarado, no crece', async () => {
    const z = zipSync({ 'notes/a.md': [new Uint8Array(8 * 1024 * 1024), { level: 9 }] });
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    for (let i = 0; i < z.length - 4; i++) {
      const sig = dv.getUint32(i, true);
      if (sig === 0x04034b50) dv.setUint32(i + 22, 1000, true);
      if (sig === 0x02014b50) dv.setUint32(i + 24, 1000, true);
    }
    const r = await parseZip(z, { ...LIMITS, maxFileBytes: 1024 * 1024 });
    expect(r.files[0]!.data.length).toBe(1000);
  });
});

// ───────────────────────── 7 · calendario ─────────────────────────
const localDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ics = (...ev: string[]) => ['BEGIN:VCALENDAR', ...ev.flatMap((e) => ['BEGIN:VEVENT', ...e.split('\n'), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

describe('auditoría · calendario', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('una serie DAILY que empezó hace más de ~16 años sigue apareciendo (tope de 6000 iteraciones desde el inicio)', () => {
    const [b] = fromICS(ics('UID:d\nDTSTART:20050103T090000\nDTEND:20050103T100000\nRRULE:FREQ=DAILY'));
    expect(occurrences(b!, '2026-11-02', '2026-11-08', localDay)).toHaveLength(7);
  });

  // auditoría: cambiar a it() al corregir
  it.fails('una excepción RECURRENCE-ID sustituye a la ocurrencia original (no se pinta dos veces)', () => {
    const bs = fromICS(ics(
      'UID:s@x\nDTSTART:20261102T090000\nDTEND:20261102T100000\nRRULE:FREQ=WEEKLY',
      'UID:s@x\nRECURRENCE-ID:20261109T090000\nDTSTART:20261109T120000\nDTEND:20261109T130000',
    ));
    const onDay = bs.flatMap((b) => occurrences(b, '2026-11-09', '2026-11-09', localDay));
    expect(onDay).toHaveLength(1);
  });

  // auditoría: cambiar a it() al corregir
  it.fails('VALARM TRIGGER:-P1D es un día antes (1440 min), no a la hora del evento', () => {
    const [b] = fromICS(ics('UID:a\nDTSTART:20261110T090000\nDTEND:20261110T100000\nBEGIN:VALARM\nTRIGGER:-P1D\nACTION:DISPLAY\nEND:VALARM'));
    expect(b!.alarmMin).toBe(1440);
  });

  // auditoría: cambiar a it() al corregir
  it.fails('DTSTART;TZID=America/New_York se interpreta en esa zona, no en la del dispositivo', () => {
    const [b] = fromICS(ics('UID:z\nDTSTART;TZID=America/New_York:20261110T090000\nDTEND;TZID=America/New_York:20261110T100000'));
    expect(b!.start).toBe(Date.UTC(2026, 10, 10, 14, 0, 0));
  });
});
