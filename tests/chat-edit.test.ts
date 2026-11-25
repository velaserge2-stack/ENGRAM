import { beforeEach, describe, expect, it } from 'vitest';
import { parseDeck } from '../src/cards/parse';
import { loadCollection } from '../src/data/collection';
import { diffLines } from '../src/chat/diff';
import { applyProposal, forgetProposals, revalidate, undoProposal, wantsWrite, type Proposal } from '../src/chat/proposal';
import { appendToNote, editProposal, makeEditTools, replaceInNote, retag } from '../src/chat/tools-edit';
import { parseFrontmatter } from '../src/lib/frontmatter';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { parseBankMarkdown } from '../src/sim/parse';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const NOTE = '---\ntitle: ECG\ntags: [cardio]\n---\n# ECG\n\n## Ondas\nLa onda P es auricular.\n\n## Ritmo\nRegular.\n';
const DECK = '---\ndeck: Bio\n---\nQ:: ¿Qué es la mitosis?\nA:: División celular ^abcde\n\nCloze: La {{c1::mitocondria}} produce ATP ^fghij\n';
const BANK = '---\nbanco: Cardio\nminutos: 30\n---\n1. ¿Cuántas derivaciones tiene el ECG?\nA) 6\nB) 12\nRespuesta: B\n';
let v: SafeVault, got: Proposal[];
const run = (tools: any, name: string, input: object) => tools[name].execute(input, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const tools = async (allowed = true) => makeEditTools({ vault: v, col: await loadCollection(v, DEFAULT_PARAMS), today: '2026-03-01', sources: [], allowed: () => allowed, propose: (p) => got.push(p) });
beforeEach(async () => {
  forgetProposals(); got = [];
  v = new SafeVault(new MemoryBackend());
  await v.write('notes/ECG.md', enc(NOTE)); await v.write('notes/Otra.md', enc('# Otra\n')); await v.write('notes/Otra 2.md', enc('# Otra 2\n'));
  await v.write('decks/Bio.md', enc(DECK)); await v.write('exams-bank/Cardio.md', enc(BANK));
  await v.write('exams/Parcial.md', enc('---\nexamen: Parcial\nfecha: 2026-06-01\ntemas: [Bio]\nmeta_retencion: 0.9\ndias_repaso_final: 7\ncreado: 2026-01-01\n---\n'));
});

describe('piezas puras', () => {
  it('diff: solo lo que cambia, con una línea de contexto', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual(['  a', '− b', '+ B']);
    expect(diffLines('x', 'x')).toEqual([]);
  });
  it('añadir: al final y bajo un encabezado (antes del siguiente)', () => {
    expect(appendToNote(NOTE, 'Nueva línea')).toMatch(/Regular\.\n\nNueva línea\n$/);
    const r = appendToNote(NOTE, 'Onda Q', 'ondas') as string;
    expect(r.indexOf('Onda Q')).toBeGreaterThan(r.indexOf('auricular')); expect(r.indexOf('Onda Q')).toBeLessThan(r.indexOf('## Ritmo'));
    expect(appendToNote(NOTE, 'x', 'Nada')).toMatchObject({ error: 'encabezado' });
    expect(appendToNote('# A\n## X\n## X\n', 'x', 'X')).toMatchObject({ error: 'varios' });
    expect(appendToNote(NOTE, '  ')).toMatchObject({ error: 'vacio' });
  });
  it('reemplazar: único, exacto, solo en el cuerpo', () => {
    expect(replaceInNote(NOTE, 'auricular', 'de las aurículas')).toContain('de las aurículas');
    expect(replaceInNote(NOTE, 'zzzzz', 'x')).toMatchObject({ error: 'nofragmento' });
    expect(replaceInNote('uno dos uno', 'uno', 'x')).toMatchObject({ error: 'ambiguo' });
    expect(replaceInNote(NOTE, 'cardio', 'x')).toMatchObject({ error: 'nofragmento' }); // el frontmatter no se toca
    expect(replaceInNote(NOTE, 'ab', 'x')).toMatchObject({ error: 'fragmento' });
  });
  it('etiquetas en el frontmatter existente', () => {
    const r = retag(NOTE, ['#Nuevo tag', 'cardio'], []) as string;
    expect(parseFrontmatter(r).data.tags).toEqual(['cardio', 'Nuevo-tag']);
    expect(parseFrontmatter(retag(r, [], ['CARDIO']) as string).data.tags).toEqual(['Nuevo-tag']);
    expect(parseFrontmatter(retag('# sin fm\n', ['a'], []) as string).data.tags).toEqual(['a']);
    expect((retag(NOTE, [], ['cardio']) as string)).not.toContain('tags');
    expect(r.endsWith(NOTE.slice(NOTE.indexOf('# ECG')))).toBe(true); // el cuerpo no cambia
  });
  it('sin cambio no hay propuesta', () => { expect(editProposal('notes/a.md', 'x', 'x', 'r')).toMatchObject({ error: 'igual' }); });
});

describe('herramientas: resolución, ambigüedad y escritura solo tras Aceptar', () => {
  it('no escribe nada al proponer y respeta `allowed`', async () => {
    const t = await tools();
    const r = await run(t, 'editar_nota', { nota: 'ECG', buscar: 'auricular', reemplazar: 'de las aurículas' });
    expect(r.estado).toMatch(/PROPUESTA/);
    expect(got).toHaveLength(1); expect(got[0]!.items).toEqual(['  ## Ondas', '− La onda P es auricular.', '+ La onda P es de las aurículas.']);
    expect(dec(await v.read('notes/ECG.md'))).toBe(NOTE);
    got = []; expect(await run(await tools(false), 'editar_nota', { nota: 'ECG', buscar: 'auricular', reemplazar: 'x' })).toHaveProperty('error'); expect(got).toHaveLength(0);
  });
  it('aceptar escribe por el vault y deshacer restaura', async () => {
    await run(await tools(), 'anadir_a_nota', { nota: 'ECG', texto: 'Onda T: repolarización.', bajo_encabezado: 'Ondas' });
    await applyProposal(v, null, got[0]!, 1);
    expect(dec(await v.read('notes/ECG.md'))).toContain('Onda T');
    await undoProposal(v, 1);
    expect(dec(await v.read('notes/ECG.md'))).toBe(NOTE);
  });
  it('si el archivo cambió después de proponer, no se pisa', async () => {
    await run(await tools(), 'etiquetar_nota', { nota: 'ECG', anadir: ['examen'] });
    await v.write('notes/ECG.md', enc(NOTE + 'cambio del usuario\n'));
    await expect(applyProposal(v, null, got[0]!, 2)).rejects.toThrow('changed');
    expect(dec(await v.read('notes/ECG.md'))).toContain('cambio del usuario');
  });
  it('varios / noexiste / ambiguo se devuelven al modelo', async () => {
    const t = await tools();
    expect((await run(t, 'anadir_a_nota', { nota: 'Ot', texto: 'x' })).error).toMatch(/varios/); // dos parciales: nunca elige solo
    expect((await run(t, 'etiquetar_nota', { nota: 'Inexistente', anadir: ['a'] })).error).toMatch(/noexiste/);
    expect((await run(t, 'editar_nota', { nota: 'ECG', buscar: 'no está', reemplazar: 'x' })).error).toMatch(/nofragmento/);
    expect(got).toHaveLength(0);
  });
  it('etiquetar_nota deja el frontmatter y las claves de archivo intactos', async () => {
    await run(await tools(), 'etiquetar_nota', { nota: 'ECG', anadir: ['urgencias'] });
    await applyProposal(v, null, got[0]!, 3);
    const d = parseFrontmatter(dec(await v.read('notes/ECG.md')));
    expect(d.data.tags).toEqual(['cardio', 'urgencias']); expect(d.data.title).toBe('ECG');
  });
  it('editar_tarjeta conserva el ID y marca origen: ia', async () => {
    await run(await tools(), 'editar_tarjeta', { mazo: 'Bio', tarjeta: '¿Qué es la mitosis?', respuesta: 'División del núcleo en dos núcleos iguales' });
    expect(got[0]!.contenido).toContain('^abcde');
    await applyProposal(v, null, got[0]!, 4);
    const notes = parseDeck(dec(await v.read('decks/Bio.md'))).notes;
    expect(notes.map((n) => n.id)).toEqual(['abcde', 'fghij']);
    expect(notes[0]!.back).toContain('núcleo'); expect(notes[0]!.raw).toContain('origen: ia'); expect(notes[1]!.front).toContain('mitocondria');
    const byId = await run(await tools(), 'editar_tarjeta', { mazo: 'Bio', tarjeta: '^fghij', cloze: 'La {{c1::mitocondria}} genera {{c2::ATP}}' });
    expect(byId.estado).toMatch(/PROPUESTA/);
    expect((await run(await tools(), 'editar_tarjeta', { mazo: 'Bio', tarjeta: 'zzzz', respuesta: 'x' })).error).toMatch(/noexiste/);
    expect((await run(await tools(), 'editar_tarjeta', { mazo: 'Bio', tarjeta: 'fghij', respuesta: 'x' })).error).toMatch(/tipo|cloze/);
  });
  it('añadir preguntas al banco las renumera y marca origen: ia', async () => {
    await run(await tools(), 'anadir_preguntas_a_banco', { banco: 'Cardio', preguntas: [{ texto: '¿Qué onda es auricular?', opciones: ['P', 'QRS'], correcta: 'A' }] });
    await applyProposal(v, null, got[0]!, 5);
    const text = dec(await v.read('exams-bank/Cardio.md')), b = parseBankMarkdown(text, '');
    expect(b.questions.map((q) => q.n)).toEqual([1, 2]); expect(b.questions.every((q) => !q.problems.length)).toBe(true); expect(text).toContain('origen: ia');
  });
  it('modificar_examen cambia solo lo pedido y valida', async () => {
    await run(await tools(), 'modificar_examen', { nombre: 'Parcial', fecha: '2026-07-15' });
    expect(got[0]!.contenido).toContain('2026-07-15'); expect(got[0]!.contenido).toContain('temas: [Bio]');
    expect((await run(await tools(), 'modificar_examen', { nombre: 'Parcial', fecha: '2025-01-01' })).error).toMatch(/pasada/);
    expect((await run(await tools(), 'modificar_examen', { nombre: 'Parcial', temas: ['Inventado'] })).error).toMatch(/temas/);
  });
  it('«Editar» en la vista previa revalida según el archivo', async () => {
    await run(await tools(), 'editar_nota', { nota: 'ECG', buscar: 'Regular.', reemplazar: 'Irregular.' });
    const p = got[0]!, r = revalidate(p, { contenido: p.contenido.replace('Irregular.', 'Irregularmente irregular.') }) as Proposal;
    expect(r.items.join('\n')).toContain('+ Irregularmente irregular.');
    expect(revalidate(p, { contenido: '  ' })).toMatchObject({ error: 'vacio' });
  });
  it('el destino de una edición solo puede ser notas, mazos, bancos o exámenes', async () => {
    const bad: Proposal = { tipo: 'edicion', destino: '.app/state.json', contenido: 'x', antes: '', huella: '0:0', items: [], resumen: 'x' };
    await expect(applyProposal(v, null, bad, 6)).rejects.toThrow('path');
    await expect(applyProposal(v, null, { ...bad, destino: 'notes/../x.md' }, 7)).rejects.toThrow('path');
  });
});

describe('activación de escritura', () => {
  it('regresión: «¿puedes hacer notas con tags?» habilita escritura', () => {
    expect(wantsWrite('oye tú puedes hacer notas o notas con tags?')).toBe(true);
    expect(wantsWrite('can you add tags to my notes?')).toBe(true);
    expect(wantsWrite('pouvez-vous modifier une carte ?')).toBe(true);
    expect(wantsWrite('¿puedes editar mi examen?')).toBe(true);
    expect(wantsWrite('añade una línea a mi nota de ECG')).toBe(true);
    expect(wantsWrite('corrige el error en esa tarjeta')).toBe(true);
  });
  it('sin pedirlo no se activa', () => {
    expect(wantsWrite('¿qué es la mitosis?')).toBe(false);
    expect(wantsWrite('explícame las ondas del ECG')).toBe(false);
    expect(wantsWrite('puedes explicarme la mitosis')).toBe(false);
  });
});
