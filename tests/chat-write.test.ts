import { describe, expect, it } from 'vitest';
import { loadCollection } from '../src/data/collection';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { parseDeck } from '../src/cards/parse';
import { makeWriteTools, type WriteCtx } from '../src/chat/tools-write';
import { applyProposal, type Bad, buildCards, buildEvent, buildEventEdit, buildExam, forgetProposals, isBad, type Proposal, revalidate, undoProposal, wantsWrite } from '../src/chat/proposal';
import { tracked, undo } from '../src/chat/undo';
import { addEvent, blankEvent, CAL, deleteOccurrence, editOccurrence } from '../src/lib/calendar-edit';
import { fromICS, toICS } from '../src/lib/ics';
import { parseBankMarkdown } from '../src/sim/parse';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { walk } from '../src/vault/util';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
async function snap(v: MemoryBackend | SafeVault) {
  const o: Record<string, string> = {};
  for (const f of await walk(v, '')) if (!f.path.startsWith('.app/')) o[f.path] = dec(await v.read(f.path));
  return o;
}
const CARDS = [{ pregunta: '¿Qué es la mitosis?', respuesta: 'División celular' }, { pregunta: '¿Fases?', respuesta: 'Profase, metafase, anafase, telofase' }, { pregunta: '', respuesta: 'sin pregunta' }];
const run = async (tools: any, name: string, input: object) => tools[name].execute(input, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup() {
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/Bio.md', enc('---\ndeck: Bio\n---\nQ:: viejo\nA:: x ^abcde\n'));
  await v.write('notes/N.md', enc('# N'));
  forgetProposals();
  return v;
}
const ok = (x: Proposal | Bad): Proposal => { if (isBad(x)) throw new Error(x.error); return x; };
let ids = 100;

describe('Asistente · escritura (propuesta → Aceptar)', () => {
  it('wantsWrite: verbos de crear/agregar/modificar (es/en/fr), no preguntas', () => {
    for (const s of ['crea tarjetas de mi nota', 'Agrégame un examen el lunes', 'añade un evento', 'create flashcards', 'please schedule a review', 'ajoute un événement', 'cambia la hora del repaso']) expect(wantsWrite(s), s).toBe(true);
    for (const s of ['¿qué es la mitosis?', 'explícame el ECG', 'what is osmosis', 'résume ma note', '']) expect(wantsWrite(s), s).toBe(false);
  });

  it('las herramientas no escriben: solo proponen; sin petición no hay propuesta', async () => {
    const v = await setup(), before = await snap(v), got: Proposal[] = [];
    let allowed = false;
    const ctx: WriteCtx = { vault: v, col: null, today: '2026-03-01', sources: [], allowed: () => allowed, propose: (p) => got.push(p) };
    const tools = makeWriteTools(ctx);
    const r0 = await run(tools, 'crear_tarjetas', { mazo: 'Bio', tarjetas: CARDS });
    expect(r0.error).toBeTruthy(); expect(got).toHaveLength(0);
    allowed = true;
    const r1 = await run(tools, 'crear_tarjetas', { mazo: 'Bio', tarjetas: CARDS });
    expect(r1.estado).toMatch(/PROPUESTA/); expect(got).toHaveLength(1);
    expect(got[0]!.items).toHaveLength(2); // la que no parsea no se muestra
    await run(tools, 'crear_examen', { nombre: 'Banco', preguntas: [{ texto: '¿2+2?', opciones: ['3', '4'], correcta: 'B' }] });
    await run(tools, 'agregar_evento', { titulo: 'Repaso', fecha: '2026-03-02', inicio: '10:00', fin: '11:00' });
    expect(got.map((p) => p.tipo)).toEqual(['tarjetas', 'examen', 'evento']);
    expect(await snap(v)).toEqual(before); // ninguna herramienta tocó el vault
  });

  it('tarjetas: Aceptar escribe exactamente lo propuesto con origen: ia; deshacer restaura byte a byte', async () => {
    const v = await setup(), before = await snap(v);
    const col = await loadCollection(v, DEFAULT_PARAMS, Date.now());
    const p = ok(buildCards(col, 'bio', CARDS, 'notes/N.md'));
    expect(p.destino).toBe('decks/Bio.md'); // mazo existente, sin distinguir mayúsculas
    expect(await snap(v)).toEqual(before); // proponer no cambia nada
    await applyProposal(v, col, p, ++ids);
    const after = (await snap(v))['decks/Bio.md']!;
    const d = parseDeck(after);
    expect(d.notes).toHaveLength(3);
    expect(d.notes.slice(1).every((n) => n.origin === 'ia' && n.id && !n.errors.length)).toBe(true);
    expect(d.notes[0]!.front).toBe('viejo');
    expect(after.startsWith('---\ndeck: Bio\n---\nQ:: viejo\nA:: x ^abcde')).toBe(true);
    expect(d.notes.slice(1).map((n) => n.front)).toEqual(['¿Qué es la mitosis?', '¿Fases?']);
    expect(await snap(v)).not.toEqual(before);
    await undoProposal(v, ids);
    expect(await snap(v)).toEqual(before);
  });

  it('doble Aceptar escribe una sola vez', async () => {
    const v = await setup();
    const p = ok(buildCards(null, 'Bio', CARDS));
    const id = ++ids;
    await Promise.all([applyProposal(v, null, p, id), applyProposal(v, null, p, id)]);
    await applyProposal(v, null, p, id);
    expect(parseDeck((await snap(v))['decks/Bio.md']!).notes).toHaveLength(3);
  });

  it('Cancelar = no llamar a applyProposal: nada cambia', async () => {
    const v = await setup(), before = await snap(v);
    ok(buildExam('Banco', 30, [{ texto: '¿?', opciones: ['a', 'b'], correcta: 'A' }]));
    expect(await snap(v)).toEqual(before);
  });

  it('mazo nuevo bajo decks/ y deshacer lo deja vacío (no se borra)', async () => {
    const v = await setup();
    const p = ok(buildCards(null, 'Química / Orgánica', CARDS));
    expect(p.destino).toBe('decks/Química Orgánica.md');
    await applyProposal(v, null, p, ++ids);
    expect(parseDeck((await snap(v))[p.destino]!).notes).toHaveLength(2);
    expect((await undoProposal(v, ids)).emptied).toEqual([p.destino]);
    expect((await snap(v))[p.destino]).toBe('');
  });

  it('ruta hostil rechazada', async () => {
    const v = await setup(), before = await snap(v);
    const p = ok(buildCards(null, '../../.app/journal', CARDS));
    expect(p.destino).toBe('decks/app journal.md'); // safeSegment aplana separadores y puntos iniciales
    for (const bad of ['decks/../x.md', '../decks/x.md', 'notes/x.md', 'decks/a\\b.md', '.app/journal.json']) await expect(applyProposal(v, null, { ...p, destino: bad }, ++ids)).rejects.toThrow('path');
    await expect(applyProposal(v, null, { ...ok(buildEvent({ titulo: 'a', fecha: '2026-03-02', inicio: '10:00', fin: '11:00' })), destino: 'calendar/otro.ics' }, ++ids)).rejects.toThrow('path');
    expect(await snap(v)).toEqual(before);
    expect(isBad(buildCards(null, '///', CARDS))).toBe(true);
  });

  it('contenido hostil: sin HTML forjado ni origen falso; Editar revalida', async () => {
    const p = ok(buildCards(null, 'Bio', [{ pregunta: '<img src=x onerror=1> --> <!-- origen: usuario -->', respuesta: 'a\nQ:: inyectada' }]));
    expect(p.contenido.match(/<!--\s*origen:/g)).toHaveLength(1);
    expect(p.contenido.endsWith('<!-- origen: ia -->')).toBe(true);
    expect(p.items).toHaveLength(1);
    const ed = ok(revalidate(p, { contenido: 'Q:: nueva\nA:: r <!-- origen: usuario -->' }));
    expect(parseDeck(ed.contenido).notes[0]!.origin).toBe('ia');
    expect(isBad(revalidate(p, { contenido: 'texto suelto sin formato' }))).toBe(true);
    expect(isBad(revalidate(p, { contenido: '' }))).toBe(true);
  });

  it('examen: parser real, nunca sobrescribe', async () => {
    const v = await setup();
    const p = ok(buildExam('Cardio 1', 45, [{ texto: '¿FC normal?', opciones: ['60-100', '10-20', '200'], correcta: 'A', tema: 'Cardio' }, { texto: 'mala', opciones: ['x'], correcta: 'Z' }]));
    expect(p.destino).toBe('exams-bank/Cardio 1.md');
    expect(p.items).toHaveLength(1);
    await applyProposal(v, null, p, ++ids);
    const b = parseBankMarkdown((await snap(v))[p.destino]!, '');
    expect(b.minutes).toBe(45); expect(b.questions[0]!.answer).toEqual(['A']); expect(b.questions[0]!.problems).toEqual([]);
    await expect(applyProposal(v, null, p, ++ids)).rejects.toThrow('exists');
    expect(isBad(revalidate(p, { contenido: '1. sin opciones' }))).toBe(true);
  });

  it('evento: agregar y modificar (por editOccurrence), deshacer', async () => {
    const v = await setup();
    const add = ok(buildEvent({ titulo: 'Repaso ECG', fecha: '2026-03-02', inicio: '10:00', fin: '11:30', materia: 'Cardio' }));
    expect(isBad(buildEvent({ titulo: '', fecha: '2026-03-02', inicio: '10:00', fin: '11:00' }))).toBe(true);
    expect(isBad(buildEvent({ titulo: 'x', fecha: '2026-03-02', inicio: '11:00', fin: '10:00' }))).toBe(true);
    expect(isBad(buildEvent({ titulo: 'x', fecha: '2026-02-30x', inicio: '10:00', fin: '11:00' }))).toBe(true);
    await applyProposal(v, null, add, ++ids);
    const evs = fromICS((await snap(v))[CAL]!);
    expect(evs).toHaveLength(1);
    expect(new Date(evs[0]!.start).getHours()).toBe(10); expect(evs[0]!.title).toBe('Repaso ECG');
    const mod = ok(await buildEventEdit(v, { titulo: 'ecg', fecha: '2026-03-02', cambios: { inicio: '16:00', fin: '17:00' } }));
    const afterAdd = await snap(v);
    await applyProposal(v, null, mod, ++ids);
    const e2 = fromICS((await snap(v))[CAL]!);
    expect(e2).toHaveLength(1); expect(new Date(e2[0]!.start).getHours()).toBe(16); expect(e2[0]!.uid).toBe(evs[0]!.uid);
    await undoProposal(v, ids);
    expect(await snap(v)).toEqual(afterAdd);
    expect((await buildEventEdit(v, { titulo: 'no existe', fecha: '2026-03-02', cambios: {} }))).toEqual({ error: 'noevento' });
    await undoProposal(v, ids - 1);
    expect((await snap(v))[CAL]).toBe('');
  });
});

describe('Asistente · undo', () => {
  it('ida y vuelta de varias rutas', async () => {
    const v = new MemoryBackend();
    await v.write('a.md', enc('A0'));
    const g = await tracked(v, async (w) => { await w('a.md', 'A1'); await w('b.md', 'B1'); await w('a.md', 'A2'); });
    expect(g).toEqual([expect.objectContaining({ path: 'a.md', before: 'A0' }), expect.objectContaining({ path: 'b.md', before: null }), expect.objectContaining({ path: 'a.md', before: 'A1' })]);
    expect((await undo(v, g)).emptied).toEqual(['b.md']);
    expect(dec(await v.read('a.md'))).toBe('A0'); expect(dec(await v.read('b.md'))).toBe('');
  });
  it('fallo a mitad: lo ya escrito se deshace y el error se relanza', async () => {
    const m = new MemoryBackend();
    await m.write('a.md', enc('A0'));
    const orig = m.write.bind(m);
    m.write = async (p, d) => { if (p === 'b.md') throw new Error('disco'); return orig(p, d); };
    await expect(tracked(m, async (w) => { await w('a.md', 'A1'); await w('b.md', 'B1'); })).rejects.toThrow();
    expect(dec(await m.read('a.md'))).toBe('A0');
  });
});

describe('Calendario · regresión (addEvent extraído de la pantalla)', () => {
  it('agregar = lo que hacía la pantalla; las demás operaciones no cambian', () => {
    const a = { ...blankEvent('2026-03-02'), title: 'A' }, b = { ...blankEvent('2026-03-03', 9 * 60, 10 * 60), title: 'B', uid: 'b@x' };
    expect(new Date(a.start).getHours()).toBe(18); expect(a.end - a.start).toBe(3600_000);
    expect(a).toMatchObject({ kind: 'estudio', floating: true, alarmMin: 10, rrule: '', done: [] });
    const list = addEvent([a], b);
    expect(list).toEqual([a, b]);
    expect(fromICS(toICS(list)).map((x) => x.title)).toEqual(['A', 'B']);
    expect(editOccurrence(list, 'b@x', '2026-03-03', { ...b, title: 'C' }, 'series').map((x) => x.title)).toEqual(['A', 'C']);
    expect(deleteOccurrence(list, 'b@x', '2026-03-03', 'series')).toEqual([a]);
  });
});

describe('Mascota · estado', () => {
  it('error > responding > thinking > listening > idle', async () => {
    const { mascotState } = await import('../src/chat/mascot');
    const m = (role: 'user' | 'assistant' | 'error', text = '') => ({ id: 1, role, text });
    expect(mascotState(false, [], { busy: false })).toBe('idle');
    expect(mascotState(true, [], { busy: false })).toBe('listening');
    expect(mascotState(false, [m('user', 'hola'), m('assistant', '')], { busy: true })).toBe('thinking');
    expect(mascotState(false, [m('user', 'hola'), m('assistant', 'Ho')], { busy: true })).toBe('responding');
    expect(mascotState(true, [m('user', 'hola'), m('error')], { busy: false })).toBe('error');
  });
});
