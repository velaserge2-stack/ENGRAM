import { describe, expect, it } from 'vitest';
import { loadCollection } from '../src/data/collection';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { makeWriteTools, type WriteCtx } from '../src/chat/tools-write';
import { applyProposal, forgetProposals, isBad, type Proposal, revalidate, undoProposal, wantsWrite } from '../src/chat/proposal';
import { buildDiagram, buildExamDate, buildNote } from '../src/chat/make';
import { parseExam } from '../src/lib/exams';
import { parseFrontmatter } from '../src/lib/frontmatter';
import { createNote } from '../src/notes/create';
import { diagramKindOf } from '../src/notes/diagramtype';
import { listNotes, trashList } from '../src/notes/model';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { walk } from '../src/vault/util';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
async function snap(v: MemoryBackend | SafeVault) {
  const o: Record<string, string> = {};
  for (const f of await walk(v, '')) if (!f.path.startsWith('.app/')) o[f.path] = dec(await v.read(f.path));
  return o;
}
const TODAY = '2026-11-24';
const NOW = new Date('2026-11-24T12:00:00');
const run = async (tools: any, name: string, input: object) => tools[name].execute(input, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const enc = (s: string) => new TextEncoder().encode(s);
async function setup() {
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/Bio.md', enc('---\ndeck: Bio\ntags: [ecg]\n---\nQ:: viejo\nA:: x ^abcde\n'));
  forgetProposals();
  return v;
}
const ok = (x: Proposal | { error: string; detail?: string }): Proposal => { if (isBad(x)) throw new Error(`${x.error} ${x.detail ?? ''}`); return x; };
let ids = 500;
const ex = (v: SafeVault) => (p: string) => v.exists(p);
const MAPA = 'Cardiología\n- Anatomía\n  - Cámaras\n- Fisiología';
const FLUJO = '(Inicio) --> [Triaje] --> {¿Inestable?}\n{¿Inestable?} -- sí --> [Reanimación]';

describe('Asistente · crear nota', () => {
  it('proponer no escribe; Aceptar escribe exactamente lo propuesto (con y sin materia/tema)', async () => {
    const v = await setup(), before = await snap(v);
    const cases: [object, string][] = [
      [{ titulo: 'Arritmias', contenido: 'Texto **uno**', materia: 'Cardio', tema: 'ECG' }, 'notes/Cardio/ECG/Arritmias.md'],
      [{ titulo: 'Solo materia', contenido: 'x', materia: 'Cardio' }, 'notes/Cardio/Solo materia.md'],
      [{ titulo: 'Suelta', contenido: 'x' }, 'notes/Suelta.md'],
      [{ titulo: 'Con/barra: hostil', contenido: 'x', materia: '../..' }, ''],
    ];
    const h = ok(await buildNote(ex(v), cases[3]![0], NOW));
    expect(h.destino).toBe('notes/Con barra hostil.md'); // `../..` y `/` no escapan de notes/
    expect(await snap(v)).toEqual(before);
    for (const [a, path] of cases.slice(0, 3)) {
      const p = ok(await buildNote(ex(v), a, NOW));
      expect(p.destino).toBe(path);
      await applyProposal(v, null, p, ++ids);
      expect((await snap(v))[path]).toBe(p.contenido); // exactamente lo propuesto
      const d = parseFrontmatter(p.contenido);
      expect(d.data.origen).toBe('ia');
      expect(diagramKindOf(p.contenido)).toBe('nota');
    }
    expect((await listNotes(v)).map((n) => n.path)).toContain('notes/Suelta.md');
  });
  it('colisión: «(2)» y nunca sobrescribe, ni con una ruta ya ocupada al Aceptar', async () => {
    const v = await setup();
    await v.write('notes/Suelta.md', enc('MIO'));
    const p = ok(await buildNote(ex(v), { titulo: 'Suelta', contenido: 'x' }, NOW));
    expect(p.destino).toBe('notes/Suelta (2).md');
    await v.write('notes/Suelta (2).md', enc('OTRO'));
    await expect(applyProposal(v, null, p, ++ids)).rejects.toThrow('exists');
    expect((await snap(v))['notes/Suelta.md']).toBe('MIO');
    expect((await snap(v))['notes/Suelta (2).md']).toBe('OTRO');
  });
  it('contenido: sin frontmatter forjado, tope y vacío', async () => {
    const v = await setup();
    const p = ok(await buildNote(ex(v), { titulo: 'T', contenido: '---\ntipo: mapa\norigen: humano\n---\nHola' }, NOW));
    expect(diagramKindOf(p.contenido)).toBe('nota');
    expect(parseFrontmatter(p.contenido).data.origen).toBe('ia');
    expect(parseFrontmatter(p.contenido).body).toContain('Hola');
    expect(isBad(await buildNote(ex(v), { titulo: 'T', contenido: 'x'.repeat(20001) }, NOW))).toBe(true);
    expect(isBad(await buildNote(ex(v), { titulo: 'T', contenido: '  ' }, NOW))).toBe(true);
    expect(isBad(await buildNote(ex(v), { titulo: '///', contenido: 'x' }, NOW))).toBe(true);
    expect(isBad(await buildNote(ex(v), { titulo: 'T', contenido: 'x', materia: 'Diario' }, NOW))).toBe(true);
  });
  it('Deshacer: la nota nueva va a la papelera de notas (no queda vacía) y si cambió no se toca', async () => {
    const v = await setup();
    const p = ok(await buildNote(ex(v), { titulo: 'Efímera', contenido: 'x' }, NOW)), id = ++ids;
    await applyProposal(v, null, p, id);
    expect((await undoProposal(v, id)).emptied).toEqual([]);
    expect(await v.exists(p.destino)).toBe(false);
    expect((await trashList(v)).map((x) => x.path)).toContain(p.destino);
    const p2 = ok(await buildNote(ex(v), { titulo: 'Editada', contenido: 'x' }, NOW)), id2 = ++ids;
    await applyProposal(v, null, p2, id2);
    await v.write(p2.destino, enc('cambió'));
    await expect(undoProposal(v, id2)).rejects.toThrow('changed');
    expect((await snap(v))[p2.destino]).toBe('cambió');
  });
  it('Editar revalida: conserva origen: ia y rechaza tipo ajeno', async () => {
    const v = await setup();
    const p = ok(await buildNote(ex(v), { titulo: 'E', contenido: 'x' }, NOW));
    const r = ok(revalidate(p, { contenido: 'sin frontmatter\nhola' }));
    expect(parseFrontmatter(r.contenido).data.origen).toBe('ia');
    expect(isBad(revalidate(p, { contenido: '---\ntipo: mapa\n---\nx' }))).toBe(true);
    expect(isBad(revalidate(p, { contenido: '' }))).toBe(true);
  });
  it('createNote (pantalla Notas): mismo resultado que antes, con «(2)»', async () => {
    const v = await setup();
    const a = await createNote(v, { materia: 'M', tema: 'T', titulo: ' Clase 3 ', kind: 'nota', template: 'Resumen' }, NOW);
    const b = await createNote(v, { materia: 'M', tema: 'T', titulo: ' Clase 3 ', kind: 'nota', template: 'Resumen' }, NOW);
    expect([a, b]).toEqual(['notes/M/T/Clase 3.md', 'notes/M/T/Clase 3 (2).md']);
    expect((await snap(v))[a]).toContain('# Clase 3\n');
    expect(parseFrontmatter((await snap(v))[a]!).data).toEqual({ materia: 'M', tema: 'T', fecha: '2026-11-24', tags: [] });
    const m = await createNote(v, { materia: '', tema: '', titulo: 'Mapa', kind: 'mapa' }, NOW);
    expect(m).toBe('notes/Mapa.md');
    expect(diagramKindOf((await snap(v))[m]!)).toBe('mapa');
  });
});

describe('Asistente · crear diagrama', () => {
  it('los tres tipos: nota con tipo: y origen: ia que diagramKindOf reconoce', async () => {
    const v = await setup();
    for (const [tipo, fuente] of [['mapa', MAPA], ['flujo', FLUJO], ['diagrama', '[Triaje] --- [Revisión]']] as const) {
      const p = ok(await buildDiagram(ex(v), { tipo, titulo: `Mi ${tipo}`, fuente, materia: 'Cardio' }, NOW));
      expect(p.destino).toBe(`notes/Cardio/Mi ${tipo}.md`);
      expect(diagramKindOf(p.contenido)).toBe(tipo);
      expect(parseFrontmatter(p.contenido).data.origen).toBe('ia');
      await applyProposal(v, null, p, ++ids);
      expect(diagramKindOf((await snap(v))[p.destino]!)).toBe(tipo);
      expect(parseFrontmatter((await snap(v))[p.destino]!).body.trim()).toBe(fuente);
    }
  });
  it('inválido → error legible con línea y código; tipo/vacío/grande/fence', async () => {
    const v = await setup();
    const bad = await buildDiagram(ex(v), { tipo: 'mapa', titulo: 'X', fuente: 'Raíz\n    - salto de sangría' }, NOW);
    expect(isBad(bad) && bad.error === 'diagrama' && /línea 2/.test(bad.detail ?? '') && /sangria/.test(bad.detail ?? '')).toBe(true);
    expect(isBad(await buildDiagram(ex(v), { tipo: 'otro', titulo: 'X', fuente: MAPA }, NOW))).toBe(true);
    expect(isBad(await buildDiagram(ex(v), { tipo: 'mapa', titulo: 'X', fuente: '' }, NOW))).toBe(true);
    const big = await buildDiagram(ex(v), { tipo: 'mapa', titulo: 'X', fuente: 'R\n' + Array.from({ length: 400 }, (_, i) => `- n${i}`).join('\n') }, NOW);
    expect(isBad(big) && big.error).toBe('grande');
    const f = ok(await buildDiagram(ex(v), { tipo: 'mapa', titulo: 'X', fuente: '```mapa\n' + MAPA + '\n```' }, NOW));
    expect(parseFrontmatter(f.contenido).body.trim()).toBe(MAPA);
  });
  it('Editar revalida con el parser real', async () => {
    const v = await setup();
    const p = ok(await buildDiagram(ex(v), { tipo: 'mapa', titulo: 'X', fuente: MAPA }, NOW));
    expect(isBad(revalidate(p, { contenido: p.contenido.replace('- Anatomía', '      - roto') }))).toBe(true);
    expect(isBad(revalidate(p, { contenido: p.contenido.replace('tipo: mapa', 'tipo: flujo') }))).toBe(true);
    expect(isBad(revalidate(p, { contenido: p.contenido.replace('- Fisiología', '- Otra') }))).toBe(false);
  });
});

describe('Asistente · registrar examen', () => {
  const A = { nombre: 'Cardiología parcial 1', fecha: '2026-12-03', temas: ['bio'] };
  it('propuesta legible; Aceptar escribe exams/<nombre>.md con origen: ia; Deshacer lo quita', async () => {
    const v = await setup();
    const col = await loadCollection(v, DEFAULT_PARAMS, Date.now());
    const before = await snap(v);
    const p = ok(await buildExamDate(ex(v), col, TODAY, A));
    expect(await snap(v)).toEqual(before);
    expect(p.destino).toBe('exams/Cardiología parcial 1.md');
    expect(p.items).toEqual(['Cardiología parcial 1', '2026-12-03', 'Bio']);
    expect(p.datos).toEqual({ dias: 9 });
    await applyProposal(v, col, p, ++ids);
    const text = (await snap(v))[p.destino]!;
    expect(text).toBe(p.contenido);
    expect(parseFrontmatter(text).data.origen).toBe('ia');
    expect(parseExam(p.destino, text)).toMatchObject({ name: 'Cardiología parcial 1', date: '2026-12-03', topics: ['Bio'], goal: 0.9, finalDays: 7, created: TODAY });
    await undoProposal(v, ids);
    expect(await v.exists(p.destino)).toBe(false);
  });
  it('fecha inválida o pasada, hoy sí, temas inexistentes con sugerencia, exists, metas', async () => {
    const v = await setup();
    const col = await loadCollection(v, DEFAULT_PARAMS, Date.now());
    const err = async (a: object) => { const r = await buildExamDate(ex(v), col, TODAY, { ...A, ...a }); return isBad(r) ? r : null; };
    expect((await err({ fecha: '2026-02-30' }))?.error).toBe('fecha');
    expect((await err({ fecha: '3 de diciembre' }))?.error).toBe('fecha');
    expect((await err({ fecha: '2026-11-23' }))?.error).toBe('pasada');
    expect(await err({ fecha: TODAY })).toBeNull();
    const t = await err({ temas: ['Biologia'] });
    expect(t?.error).toBe('temas');
    expect(t?.detail).toMatch(/Bio/);
    expect((await err({ temas: ['tag:ecg'] }))).toBeNull();
    expect((await err({ temas: [] }))?.error).toBe('temas');
    expect((await err({ nombre: '  ' }))?.error).toBe('nombre');
    expect((await err({ meta_retencion: 2 }))?.error).toBe('meta');
    expect((await err({ dias_repaso_final: 99 }))?.error).toBe('dias');
    await v.write('exams/Cardiología parcial 1.md', enc('MIO'));
    expect((await err({}))?.error).toBe('exists');
    expect((await snap(v))['exams/Cardiología parcial 1.md']).toBe('MIO');
  });
  it('Editar revalida fecha y temas; aplicar nunca pisa un examen que apareció', async () => {
    const v = await setup();
    const col = await loadCollection(v, DEFAULT_PARAMS, Date.now());
    const p = ok(await buildExamDate(ex(v), col, TODAY, A));
    const env = { col, today: TODAY };
    expect(isBad(revalidate(p, { contenido: p.contenido.replace('2026-12-03', '2020-01-01') }, env))).toBe(true);
    expect(isBad(revalidate(p, { contenido: p.contenido.replace('[Bio]', '[Nada]') }, env))).toBe(true);
    expect(isBad(revalidate(p, { contenido: p.contenido.replace('2026-12-03', '2026-12-04') }, env))).toBe(false);
    await v.write(p.destino, enc('MIO'));
    await expect(applyProposal(v, col, p, ++ids)).rejects.toThrow('exists');
    expect((await snap(v))[p.destino]).toBe('MIO');
  });
});

describe('Asistente · herramientas y rutas', () => {
  it('sin permiso no proponen; con permiso, MAX_PROPOSALS y nada escrito sin Aceptar', async () => {
    const v = await setup(), before = await snap(v);
    const got: Proposal[] = [];
    const col = await loadCollection(v, DEFAULT_PARAMS, Date.now());
    const mk = (allowed: boolean) => makeWriteTools({ vault: v, col, today: TODAY, sources: [], allowed: () => allowed, propose: (p) => got.push(p) } as WriteCtx);
    expect((await run(mk(false), 'crear_nota', { titulo: 'A', contenido: 'x' })).error).toMatch(/no pidió/);
    expect(got).toHaveLength(0);
    const t = mk(true);
    expect((await run(t, 'crear_nota', { titulo: 'A', contenido: 'x' })).estado).toMatch(/PROPUESTA/);
    expect((await run(t, 'crear_nota', { titulo: 'A', contenido: 'y' })).estado).toMatch(/PROPUESTA/);
    expect(got.map((p) => p.destino)).toEqual(['notes/A.md', 'notes/A (2).md']); // reserva dentro del turno
    expect((await run(t, 'crear_diagrama', { tipo: 'mapa', titulo: 'M', fuente: 'Raíz\n    - mal' })).error).toMatch(/línea 2/);
    expect((await run(t, 'crear_diagrama', { tipo: 'mapa', titulo: 'M', fuente: MAPA })).estado).toMatch(/PROPUESTA/);
    expect((await run(t, 'registrar_examen', { ...{ nombre: 'E', fecha: '2026-12-01', temas: ['Bio'] } })).error).toMatch(/Límite/);
    expect(await snap(v)).toEqual(before);
  });
  it('ruta hostil rechazada al aplicar', async () => {
    const v = await setup(), before = await snap(v);
    const p = ok(await buildNote(ex(v), { titulo: 'N', contenido: 'x' }, NOW));
    for (const destino of ['notes/../.app/x.md', '../x.md', 'notes/a\\b.md', 'decks/N.md', 'notes/N.txt', '.app/notes/N.md', 'exams-bank/N.md']) {
      await expect(applyProposal(v, null, { ...p, destino }, ++ids), destino).rejects.toThrow('path');
    }
    const e = ok(await buildExamDate(ex(v), null, TODAY, { nombre: 'E', fecha: '2026-12-01', temas: ['x'] }));
    for (const destino of ['exams/a/b.md', 'exams/../x.md', 'exams-bank/E.md']) await expect(applyProposal(v, null, { ...e, destino }, ++ids), destino).rejects.toThrow('path');
    expect(await snap(v)).toEqual(before);
  });
  it('wantsWrite: crear notas/diagramas/exámenes con fecha; «hazme un resumen» no', () => {
    for (const s of ['crea una nota de la clase de ECG', 'crea una nota con un resumen de cardio', 'haz un mapa mental de arritmias', 'hazme un diagrama de flujo del triaje', 'make a flowchart of triage', 'create a mind map of the heart', 'crée une carte mentale', 'registra mi examen de Cardio el 2026-12-03', 'register my exam on 2026-12-03', 'genera un resumen en una nota', 'write a note about ECG', 'add a note on sepsis', 'hazme una nota de esto', 'crea un organigrama']) expect(wantsWrite(s), s).toBe(true);
    for (const s of ['hazme un resumen', 'hazme un resumen de cardio', 'resume mis notas', 'explícame el mapa mental de Cardio', '¿qué dice mi nota sobre ECG?', 'dame un resumen', 'qué notas tengo', 'show me my notes', 'summarize my notes', 'make it shorter', 'when is my exam?', '¿cuándo es mi examen de Cardio?']) expect(wantsWrite(s), s).toBe(false);
  });
});
