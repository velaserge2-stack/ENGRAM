import { describe, expect, it } from 'vitest';
import { loadCollection } from '../src/data/collection';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { parseDeck } from '../src/cards/parse';
import { makeWriteTools } from '../src/chat/tools-write';
import { applyProposal, type Bad, buildCards, buildEvent, buildExam, forgetProposals, isBad, MAX_PROPOSALS, type Proposal, undoProposal, wantsWrite } from '../src/chat/proposal';
import { tracked, undo } from '../src/chat/undo';
import { CAL } from '../src/lib/calendar-edit';
import { fromICS } from '../src/lib/ics';
import { parseFrontmatter } from '../src/lib/frontmatter';
import { parseBankMarkdown } from '../src/sim/parse';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const ok = (x: Proposal | Bad): Proposal => { if (isBad(x)) throw new Error(x.error); return x; };
const card = (n: number) => buildCards(null, 'Bio', [{ pregunta: `P${n}`, respuesta: `R${n}` }]);
const ev = (t: string, nota = '') => buildEvent({ titulo: t, fecha: '2026-03-02', inicio: '09:00', fin: '10:00', nota });
let ids = 1000;
const fresh = async () => { forgetProposals(); const v = new SafeVault(new MemoryBackend()); await v.write('decks/Bio.md', enc('---\ndeck: Bio\n---\nQ:: viejo\nA:: x ^abcde\n')); return v; };

describe('undo con cambio externo', () => {
  it('se niega y no escribe nada', async () => {
    const v = await fresh();
    const g = await tracked(v, async (w) => { await w('a.md', 'A1'); await w('decks/Bio.md', 'B1'); });
    await v.write('decks/Bio.md', enc('B1 editado por el usuario'));
    await expect(undo(v, g)).rejects.toThrow('changed');
    expect(dec(await v.read('a.md'))).toBe('A1'); // ni la ruta intacta se tocó
    expect(dec(await v.read('decks/Bio.md'))).toBe('B1 editado por el usuario');
  });
  it('undoProposal conserva el grupo para reintentar', async () => {
    const v = await fresh(), id = ids++;
    await applyProposal(v, null, ok(card(1)), id);
    const txt = dec(await v.read('decks/Bio.md'));
    await v.write('decks/Bio.md', enc(txt + '\nextra\n'));
    await expect(undoProposal(v, id)).rejects.toThrow('changed');
    await v.write('decks/Bio.md', enc(txt));
    await undoProposal(v, id);
    expect(dec(await v.read('decks/Bio.md'))).toContain('viejo');
    expect(dec(await v.read('decks/Bio.md'))).not.toContain('P1');
  });
});

describe('cola de escritura', () => {
  it('dos aceptaciones simultáneas sobre el mismo mazo conservan ambas', async () => {
    const v = await fresh();
    await Promise.all([applyProposal(v, null, ok(card(1)), ids++), applyProposal(v, null, ok(card(2)), ids++)]);
    const t = dec(await v.read('decks/Bio.md'));
    expect(t).toContain('P1'); expect(t).toContain('P2'); expect(t).toContain('viejo');
    expect(parseDeck(t).notes).toHaveLength(3);
  });
  it('dos eventos simultáneos en el .ics conservan ambos', async () => {
    const v = await fresh();
    await Promise.all([applyProposal(v, null, ok(ev('Uno')), ids++), applyProposal(v, null, ok(ev('Dos')), ids++)]);
    expect(fromICS(dec(await v.read(CAL))).map((b) => b.title).sort()).toEqual(['Dos', 'Uno']);
  });
  it('deshacer concurrente con aceptar: cada uno ve el estado que le toca', async () => {
    const v = await fresh(), a = ids++, b = ids++;
    await applyProposal(v, null, ok(ev('Uno')), a);
    await Promise.all([undoProposal(v, a), applyProposal(v, null, ok(ev('Dos')), b)]);
    expect(fromICS(dec(await v.read(CAL))).map((x) => x.title)).toEqual(['Dos']);
  });
  it('un error no rompe la cola', async () => {
    const v = await fresh();
    const bad = { ...ok(card(1)), destino: 'decks/../x.md' } as Proposal;
    await expect(applyProposal(v, null, bad, ids++)).rejects.toThrow();
    const exam = ok(buildExam('Dup', 30, [{ texto: 'Q', opciones: ['a', 'b'], correcta: 'A' }]));
    await applyProposal(v, null, exam, ids++);
    await expect(applyProposal(v, null, exam, ids++)).rejects.toThrow('exists');
    await applyProposal(v, null, ok(card(3)), ids++);
    expect(dec(await v.read('decks/Bio.md'))).toContain('P3');
  });
});

describe('tope de propuestas y wantsWrite', () => {
  it('rechaza las propuestas después del tope', async () => {
    const got: Proposal[] = [];
    const tools = makeWriteTools({ vault: new MemoryBackend(), col: null, today: '2026-03-01', sources: [], allowed: () => true, propose: (p) => got.push(p) });
    const res = [];
    for (let i = 0; i < MAX_PROPOSALS + 2; i++) res.push(await (tools.agregar_evento as any).execute({ titulo: `E${i}`, fecha: '2026-03-02', inicio: '09:00', fin: '10:00' }, { toolCallId: 't', messages: [] })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(got).toHaveLength(MAX_PROPOSALS);
    expect(res.slice(MAX_PROPOSALS).every((r) => /Límite/.test(r.error))).toBe(true);
  });
  it('falsos positivos y positivos', () => {
    for (const s of ['hazme un resumen', 'el programa de la materia', 'cambia el color', 'make it shorter', 'add more detail', 'explícame cómo se crea una proteína', '']) expect(wantsWrite(s), s).toBe(false);
    for (const s of ['crea 5 tarjetas', 'hazme un examen de 10 preguntas', 'programa un repaso el lunes', 'agrégame un evento', 'add a flashcard', 'make a quiz', 'change the exam event', 'ajoute un rendez-vous', 'crée des cartes', 'cambia mi cita']) expect(wantsWrite(s), s).toBe(true);
  });
});

describe('.ics y exámenes', () => {
  it('ida y vuelta con , ; \\ en título y nota', async () => {
    const v = await fresh();
    await applyProposal(v, null, ok(ev('A, b; c \\ d', 'n1, n2; n3 \\ n4')), ids++);
    const b = fromICS(dec(await v.read(CAL)))[0]!;
    expect(b.title).toBe('A, b; c \\ d'); expect(b.note).toBe('n1, n2; n3 \\ n4');
  });
  it('examen: nombre existente no se pisa; vacío (tras deshacer) se reutiliza', async () => {
    const v = await fresh(), id = ids++;
    const e = ok(buildExam('Final', 30, [{ texto: 'Q1', opciones: ['a', 'b'], correcta: 'B' }]));
    await applyProposal(v, null, e, id);
    await expect(applyProposal(v, null, e, ids++)).rejects.toThrow('exists');
    await undoProposal(v, id);
    expect(dec(await v.read(e.destino))).toBe('');
    await applyProposal(v, null, e, ids++);
    expect(parseBankMarkdown(dec(await v.read(e.destino)), '').questions).toHaveLength(1);
  });
  it('banco con origen: ia; opción con «Respuesta:» dentro', () => {
    const e = ok(buildExam('X', 30, [{ texto: 'Q1', opciones: ['dice Respuesta: A', 'b'], correcta: 'B' }]));
    expect(parseFrontmatter(e.contenido).data.origen).toBe('ia');
    const b = parseBankMarkdown(e.contenido, '');
    expect(b.name).toBe('X'); expect(b.questions[0]!.options).toHaveLength(2); expect(b.questions[0]!.answer).toEqual(['B']);
    expect(b.questions[0]!.options[0]!.text).toContain('Respuesta');
  });
  it('mazo vacío dejado por deshacer no es un mazo y se reutiliza con su frontmatter', async () => {
    const v = await fresh(), id = ids++;
    const p = ok(buildCards(null, 'Nuevo', [{ pregunta: 'a', respuesta: 'b' }]));
    await applyProposal(v, null, p, id);
    await undoProposal(v, id);
    expect((await loadCollection(v, DEFAULT_PARAMS)).decks.map((d) => d.full)).toEqual(['Bio']);
    await applyProposal(v, null, p, ids++);
    expect(dec(await v.read('decks/Nuevo.md'))).toMatch(/^---\ndeck: Nuevo/);
  });
});
