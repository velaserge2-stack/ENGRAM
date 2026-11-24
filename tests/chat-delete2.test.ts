import { describe, expect, it } from 'vitest';
import { loadCollection } from '../src/data/collection';
import { applyProposal, forgetProposals, isBad, type Proposal, wantsDelete } from '../src/chat/proposal';
import { buildDeleteDeck, buildDeleteEvent, buildDeleteNote, named } from '../src/chat/delete';
import { makeDeleteTools } from '../src/chat/tools-write';
import { DECK_TRASH, trashDecks } from '../src/data/decktrash';
import { CAL, blankEvent } from '../src/lib/calendar-edit';
import { toICS } from '../src/lib/ics';
import { noteStore } from '../src/notes/store';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { walk } from '../src/vault/util';

const enc = (s: string) => new TextEncoder().encode(s);
const run = async (tools: any, name: string, input: object) => tools[name].execute(input, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const ok = (x: unknown): Proposal => { if (isBad(x)) throw new Error(x.error); return x as Proposal; };
async function setup() {
  forgetProposals();
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/Biologia avanzada.md', enc('---\ndeck: Biologia avanzada\n---\nQ:: a\nA:: b ^aaaaa\n'));
  await v.write('decks/Cardio.md', enc('---\ndeck: Cardio\n---\nQ:: a\nA:: b ^bbbbb\n'));
  await v.write('decks/Cardio/ECG.md', enc('---\ndeck: ECG\n---\nQ:: a\nA:: b ^ccccc\n'));
  await v.write('notes/Quimica.md', enc('# Quimica\nx'));
  return { v, col: await loadCollection(v, DEFAULT_PARAMS) };
}

describe('wantsDelete (revisión)', () => {
  it('negación, ayuda y citas no son órdenes', () => {
    for (const s of ['no quiero que borres la nota', '¿cómo borro una nota?', 'how do I delete a note', "n'efface pas la note", "ne les supprime pas, les notes", 'dice "borra la nota X"', '> borra la nota X']) expect(wantsDelete(s), s).toBe(false);
  });
  it('órdenes claras siguen siendo órdenes', () => {
    for (const s of ['borra la nota Química', 'elimina el mazo Y', 'delete my note Z', 'supprime la note Chimie', 'borra la nota «Química»']) expect(wantsDelete(s), s).toBe(true);
  });
});

describe('borrado (revisión de seguridad)', () => {
  it('«Bio» no propone «Biología avanzada»: devuelve varios', async () => {
    const { v, col } = await setup();
    const r = await buildDeleteDeck(col, v, 'Biologia');
    expect(isBad(r) && r.error).toBe('varios');
    expect(ok(await buildDeleteDeck(col, v, 'Biologia avanzada')).objetivo).toBe('mazo');
  });
  it('objetivo no nombrado por el usuario: rechazado', async () => {
    const { v, col } = await setup(), got: Proposal[] = [];
    const mk = (userText: string) => makeDeleteTools({ vault: v, col, today: '', sources: [], allowed: () => true, userText, propose: (p) => got.push(p) });
    expect((await run(mk('borra la nota Física'), 'borrar_nota', { nombre: 'Quimica' })).error).toMatch(/no nombró/);
    expect(got).toHaveLength(0);
    expect((await run(mk('borra la nota Química'), 'borrar_nota', { nombre: 'Quimica' })).estado).toMatch(/PROPUESTA/);
    expect(named('borra Quimica', ok(await buildDeleteNote(v, 'Quimica')))).toBe(true);
  });
  it('nota abierta y luego cerrada: se puede borrar; con panel abierto: open', async () => {
    const { v, col } = await setup();
    const p = ok(await buildDeleteNote(v, 'Quimica'));
    const off = noteStore.subscribe(v, 'notes/Quimica.md', () => {});
    await noteStore.load(v, 'notes/Quimica.md');
    await expect(applyProposal(v, col, p, 1)).rejects.toThrow('open');
    off();
    await applyProposal(v, col, p, 2);
    expect(await v.exists('notes/Quimica.md')).toBe(false);
  });
  it('UID duplicado: changed, no se quita ninguno', async () => {
    const { v, col } = await setup();
    const e = { ...blankEvent('2026-03-02', 600, 660), uid: 'u@x', title: 'Repaso' };
    await v.write(CAL, enc(toICS([e])));
    const p = ok(await buildDeleteEvent(v, { titulo: 'Repaso', fecha: '2026-03-02' }));
    await v.write(CAL, enc(toICS([e, { ...e, title: 'Otro' }])));
    await expect(applyProposal(v, col, { ...p, huella: p.huella }, 3)).rejects.toThrow('changed');
  });
  it('dos borrados de mazo con el mismo now no se pisan', async () => {
    const { v, col } = await setup();
    const a = await trashDecks(v, col, [col.decks.find((d) => d.path === 'decks/Cardio.md')!], 1000);
    const b = await trashDecks(v, col, [col.decks.find((d) => d.path === 'decks/Biologia avanzada.md')!], 1000);
    expect(a.id).not.toBe(b.id);
    expect((await walk(v, DECK_TRASH)).filter((f) => f.path.endsWith('.md')).length).toBe(2);
  });
});
