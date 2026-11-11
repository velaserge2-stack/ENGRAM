import { describe, expect, it } from 'vitest';
import { undoMove } from '../src/data/move';
import { fromICS, toICS } from '../src/lib/ics';
import { moveNoteFolder, moveNotes, noteClashes, noteFolders, rewriteNoteRefs } from '../src/notes/move';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { readTextOr, walk } from '../src/vault/util';

const NOTE = 'notes/Cardiología/ECG/Bloqueos.md';
async function setup() {
  const v = new SafeVault(new MemoryBackend());
  await v.write(NOTE, '---\nmateria: Cardiología\ntema: ECG\nid: n7q\n---\n# Bloqueos\n\n![[ecg-1.png]]\n\n![[dibujo-abc.png]]\n');
  await v.write('notes/Cardiología/ECG/Ondas.md', '---\nmateria: Cardiología\ntema: ECG\n---\nVer [[Bloqueos]], [[Cardiología/ECG/Bloqueos|alias]] y [texto](notes/Cardiología/ECG/Bloqueos.md#x).\n');
  await v.write('notes/Urgencias/Arritmias/Taquis.md', '---\nmateria: Urgencias\ntema: Arritmias\n---\n[[notes/Cardiología/ECG/Bloqueos.md]]\n');
  await v.write('decks/Cardio.md', '---\ndeck: Cardio\n---\nQ:: ¿BAV?\nA:: r <!-- src: notes/Cardiología/ECG/Bloqueos.md#p2 --> ^a1\n');
  await v.write('.app/history/notes/Cardiología/ECG/Bloqueos.md/100.md', 'v1');
  await v.write('calendar/estudio.ics', toICS([{ uid: 'b', start: 0, end: 3600_000, title: 'x', subject: '', note: '', rrule: '', until: '', done: [], alarmMin: null, links: ['engrama://note/n7q', `engrama://note/${encodeURIComponent(NOTE)}`] }]));
  return v;
}

describe('mover notas (Prompt 6 · A2)', () => {
  it('rewriteNoteRefs: wikilinks por ruta, enlaces markdown y src:, sin tocar [[Título]] ni imágenes', () => {
    const t = 'Ver [[Bloqueos]] [[Cardiología/ECG/Bloqueos#a|x]] [y](notes/Cardiología/ECG/Bloqueos.md) <!-- src: notes/Cardiología/ECG/Bloqueos.md#p1 --> ![[ecg-1.png]]';
    expect(rewriteNoteRefs(t, NOTE, 'notes/Urgencias/Arritmias/Bloqueos.md')).toBe('Ver [[Bloqueos]] [[Urgencias/Arritmias/Bloqueos#a|x]] [y](notes/Urgencias/Arritmias/Bloqueos.md) <!-- src: notes/Urgencias/Arritmias/Bloqueos.md#p1 --> ![[ecg-1.png]]');
  });

  it('una nota con imágenes, enlaces entrantes, src: e historial a otro tema; deshacer', async () => {
    const v = await setup();
    const to = 'notes/Urgencias/Arritmias/Bloqueos.md';
    const r = await moveNotes(v, [NOTE], 'Urgencias/Arritmias');
    expect(r.moved).toEqual([[NOTE, to]]);
    const t = await readTextOr(v, to, '');
    expect(t).toContain('materia: Urgencias');
    expect(t).toContain('tema: Arritmias');
    expect(t).toContain('id: n7q');
    expect(t).toContain('![[ecg-1.png]]');
    expect(await readTextOr(v, 'notes/Cardiología/ECG/Ondas.md', '')).toContain('[[Bloqueos]], [[Urgencias/Arritmias/Bloqueos|alias]] y [texto](notes/Urgencias/Arritmias/Bloqueos.md#x)');
    expect(await readTextOr(v, 'notes/Urgencias/Arritmias/Taquis.md', '')).toContain('[[notes/Urgencias/Arritmias/Bloqueos.md]]');
    expect(await readTextOr(v, 'decks/Cardio.md', '')).toContain('src: notes/Urgencias/Arritmias/Bloqueos.md#p2');
    expect(await readTextOr(v, `.app/history/${to}/100.md`, '')).toBe('v1');
    expect(fromICS(await readTextOr(v, 'calendar/estudio.ics', ''))[0]!.links).toEqual(['engrama://note/n7q', `engrama://note/${encodeURIComponent(to)}`]);

    await undoMove(v, r.undo);
    expect(await v.exists(NOTE)).toBe(true);
    expect(await v.exists(to)).toBe(false);
    expect(await readTextOr(v, 'decks/Cardio.md', '')).toContain('src: notes/Cardiología/ECG/Bloqueos.md#p2');
    expect(await readTextOr(v, `.app/history/${NOTE}/100.md`, '')).toBe('v1');
  });

  it('nombre repetido: renombrar o reemplazar (la otra va a la papelera)', async () => {
    const v = await setup();
    await v.write('notes/Urgencias/Arritmias/Bloqueos.md', 'otra');
    expect(await noteClashes(v, [NOTE], 'Urgencias/Arritmias')).toEqual([NOTE]);
    const r = await moveNotes(v, [NOTE], 'Urgencias/Arritmias', 'rename');
    expect(r.moved[0]![1]).toBe('notes/Urgencias/Arritmias/Bloqueos (2).md');
    await undoMove(v, r.undo);
    await moveNotes(v, [NOTE], 'Urgencias/Arritmias', 'replace');
    expect(await readTextOr(v, 'notes/Urgencias/Arritmias/Bloqueos.md', '')).toContain('# Bloqueos');
    expect((await walk(v, '.app/trash')).some((f) => f.path.endsWith('Urgencias/Arritmias/Bloqueos.md'))).toBe(true);
  });

  it('un tema entero a otra materia; destinos sin el Diario', async () => {
    const v = await setup();
    await moveNoteFolder(v, 'Cardiología/ECG', 'Urgencias');
    const all = (await walk(v, 'notes')).map((f) => f.path).sort();
    expect(all).toEqual(['notes/Urgencias/Arritmias/Taquis.md', 'notes/Urgencias/ECG/Bloqueos.md', 'notes/Urgencias/ECG/Ondas.md']);
    expect(await readTextOr(v, 'notes/Urgencias/ECG/Ondas.md', '')).toContain('materia: Urgencias');
    expect(noteFolders([...all, 'notes/Diario/2026-01-01.md'])).toEqual(['Urgencias', 'Urgencias/Arritmias', 'Urgencias/ECG']);
  });
});
