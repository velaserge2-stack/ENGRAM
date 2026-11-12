import { describe, expect, it } from 'vitest';
import { buildPrompt, buildTree, classNoteFromPlaud, coverage, fillTemplate, glossarySuggestions, noteMeta, outline, parseAiResponse, plaudGroupKey, plaudKind, replaceAll, restore, snapshot, srtToText, suggestPlace, trash, trashList, unlinkedMentions, versions, wikilinks } from '../src/notes/model';
import { parseFrontmatter } from '../src/lib/frontmatter';
import { MemoryBackend } from '../src/vault/memory';
import { readText } from '../src/vault/util';

describe('estructura Materia → Tema → Notas', () => {
  it('meta y árbol', () => {
    expect(noteMeta('notes/Cardio/ECG/Clase 1.md')).toMatchObject({ materia: 'Cardio', tema: 'ECG', title: 'Clase 1', structured: true });
    expect(noteMeta('notes/suelta.md').structured).toBe(false);
    expect(noteMeta('notes/Diario/2026-11-11.md').materia).toBe('Diario');
    const t = buildTree(['notes/Cardio/ECG/b.md', 'notes/Cardio/ECG/a.md', 'notes/x/y/z/w.md', 'notes/Diario/2026-01-01.md'].map(noteMeta));
    expect(t.tree[0]!.temas[0]!.notes.map((n) => n.title)).toEqual(['a', 'b']);
    expect(t.loose.length).toBe(1);
    expect(t.daily.length).toBe(1);
  });
  it('plantillas y enlaces', () => {
    expect(fillTemplate('{{titulo}} {{fecha}} {{hora}}', 'X', new Date(2026, 0, 5, 9, 7))).toBe('X 2026-01-05 09:07');
    expect(wikilinks('ver [[Nota A]] y [[Nota B|alias]] pero no ![[img.png]]')).toEqual(['Nota A', 'Nota B']);
    expect(outline('# A\n```\n# no\n```\n## B')).toEqual([{ level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 4 }]);
    const texts = new Map([['notes/a.md', 'Habla de Fibrilación sin enlace'], ['notes/b.md', 'Ya enlaza [[Fibrilación]]']]);
    expect(unlinkedMentions('Fibrilación', 'notes/f.md', texts)).toEqual(['notes/a.md']);
  });
});

describe('historial y papelera', () => {
  it('instantáneas con separación mínima y restaurar', async () => {
    const v = new MemoryBackend();
    await v.write('notes/a.md', 'uno');
    expect(await snapshot(v, 'notes/a.md', 'uno', 1000)).toBe(true);
    expect(await snapshot(v, 'notes/a.md', 'dos', 2000)).toBe(false);
    expect(await snapshot(v, 'notes/a.md', 'dos', 1000 + 6 * 60_000)).toBe(true);
    expect((await versions(v, 'notes/a.md')).length).toBe(2);
    const stored = await trash(v, 'notes/a.md', 5);
    expect(await v.exists('notes/a.md')).toBe(false);
    expect((await trashList(v))[0]).toMatchObject({ ts: 5, path: 'notes/a.md' });
    expect(await restore(v, stored, 'notes/a.md')).toBe('notes/a.md');
    expect(await readText(v, 'notes/a.md')).toBe('uno');
  });
});

describe('tarjetas desde notas', () => {
  const body = '# T\n\nLa fibrilación auricular no tiene ondas P y el ritmo es irregularmente irregular.\n\nEl flutter auricular muestra ondas en dientes de sierra a 300 por minuto en derivaciones inferiores.';
  it('prompt y validación de la respuesta pegada', () => {
    expect(buildPrompt('T', body)).toContain('Q:: pregunta');
    const r = parseAiResponse('```\n1. Q:: ¿Ondas P en FA?\nA:: No hay\n\nCloze: El {{c1::flutter}} da dientes de sierra\n\nQ:: sin respuesta\n```');
    expect(r.map((x) => x.ok)).toEqual([true, true, false]);
  });
  it('cobertura por src y por solapamiento', () => {
    const c = coverage(body, [{ front: '¿Ondas P en fibrilación auricular?', back: 'No hay ondas', src: 'notes/a.md' }, { front: 'x', back: 'y', src: 'notes/a.md#p2' }], 'notes/a.md');
    expect(c.total).toBe(2);
    expect(c.covered.sort()).toEqual([1, 2]);
    expect(c.uncovered).toEqual([]);
    expect(coverage(body, [], 'notes/a.md').uncovered.length).toBe(2);
  });
});

describe('Plaud y glosario', () => {
  it('detecta tipo y agrupa por grabación', () => {
    expect(plaudKind('Clase cardio_summary.md')).toBe('resumen');
    expect(plaudKind('Clase cardio_transcript.txt')).toBe('transcripcion');
    expect(plaudKind('Clase cardio.srt')).toBe('transcripcion');
    expect(plaudKind('Clase cardio mind map.png')).toBe('mapa');
    expect(plaudKind('Clase cardio.mp3')).toBe('audio');
    expect(new Set(['Clase cardio_summary.md', 'Clase cardio_transcript.txt', 'Clase cardio.mp3', 'Clase Cardio (Resumen).pdf'].map(plaudGroupKey)).size).toBe(1);
    expect(srtToText('1\n00:00:01,000 --> 00:00:02,000\nHola\n\n2\n00:00:02,000 --> 00:00:03,000\nmundo')).toBe('Hola\nmundo');
  });
  it('nota de clase con resumen arriba y transcripción plegada', () => {
    const t = classNoteFromPlaud('Clase 3', [{ kind: 'transcripcion', name: 'x.txt', text: 'línea uno\nlínea dos' }, { kind: 'resumen', name: 'x.md', text: '## Ideas\n- a' }], 'Cardio', 'ECG');
    const d = parseFrontmatter(t);
    expect(d.data).toMatchObject({ materia: 'Cardio', tema: 'ECG', fuente: 'plaud' });
    expect(d.body.indexOf('## Ideas')).toBeLessThan(d.body.indexOf('[!quote]-'));
    expect(d.body).toContain('> línea dos');
  });
  it('glosario y reemplazo', () => {
    const s = glossarySuggestions('la taquicardia y la taquicardya y taquicardya otra vez', ['taquicardia']);
    expect(s).toEqual([{ wrong: 'taquicardya', right: 'taquicardia', count: 2 }]);
    expect(replaceAll('ECG, ecg y ECGs', 'ECG', 'electrocardiograma')).toEqual({ text: 'electrocardiograma, ecg y ECGs', n: 1 });
    expect(suggestPlace('Cardio - ECG clase 4', [{ materia: 'Cardio', temas: [{ tema: 'ECG', notes: [] }, { tema: 'IAM', notes: [] }] }])).toEqual({ materia: 'Cardio', tema: 'ECG' });
  });
});

describe('crear notas pidiendo solo el título (Prompt 12)', () => {
  it('notePath: materia y tema opcionales, sin carpetas vacías', async () => {
    const { notePath } = await import('../src/notes/model');
    expect(notePath('Cardio', 'ECG', 'Clase 1')).toBe('notes/Cardio/ECG/Clase 1.md'); // igual que antes
    expect(notePath('Cardio', '', 'Clase 1')).toBe('notes/Cardio/Clase 1.md');
    expect(notePath('', 'ECG', 'Clase 1')).toBe('notes/Clase 1.md'); // tema sin materia: «Sin clasificar»
    expect(notePath('', '', 'Clase 1')).toBe('notes/Clase 1.md');
    expect(notePath('  ', ' ', 'Idea')).toBe('notes/Idea.md');
    expect(notePath('Diario', '', '2026-11-12')).toBe('notes/Diario/2026-11-12.md'); // la diaria no cambia
  });
  it('títulos vacíos, prohibidos, con emoji, acentos y larguísimos', async () => {
    const { notePath, safeSegment } = await import('../src/notes/model');
    expect(notePath('', '', '   ')).toBe('notes/Sin título.md');
    expect(notePath('', '', 'a/b:c*?"<>|#^[x]')).toBe('notes/a b c x.md');
    const trav = notePath('', '', '../../etc');
    expect(trav.split('/')).toHaveLength(2);
    expect(trav.split('/')[1]!.startsWith('.')).toBe(false);
    expect(notePath('Cardiología', '', '🫀 Válvulas ñ')).toBe('notes/Cardiología/🫀 Válvulas ñ.md');
    const long = 'Á'.repeat(150) + '🫀'.repeat(60);
    const seg = safeSegment(long);
    expect(new TextEncoder().encode(seg).length).toBeLessThanOrEqual(200);
    expect(seg.includes('�')).toBe(false);
    // los duplicados conservan su sufijo aunque el título sea larguísimo
    const a = notePath('', '', long), b = notePath('', '', `${long} (2)`), c = notePath('', '', `${long} (3)`);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(b.endsWith(' (2).md')).toBe(true);
  });
  it('noteMeta y buildTree: los cuatro casos; la diaria y las antiguas igual', () => {
    expect(noteMeta('notes/Cardio/Suelta.md')).toMatchObject({ materia: 'Cardio', tema: '', structured: true });
    expect(noteMeta('notes/Suelta.md')).toMatchObject({ materia: '', tema: '', structured: false });
    expect(noteMeta('notes/Diario/2026-01-01.md')).toMatchObject({ materia: 'Diario', structured: true });
    const t = buildTree(['notes/Cardio/ECG/a.md', 'notes/Cardio/sin-tema.md', 'notes/raiz.md', 'notes/x/y/z/w.md', 'notes/Diario/2026-01-01.md'].map(noteMeta));
    expect(t.tree.map((m) => m.materia)).toEqual(['Cardio']);
    expect(t.tree[0]!.temas.map((x) => [x.tema, x.notes.map((n) => n.title)])).toEqual([['', ['sin-tema']], ['ECG', ['a']]]);
    expect(t.loose.map((n) => n.title).sort()).toEqual(['raiz', 'w']);
    expect(t.daily.map((n) => n.title)).toEqual(['2026-01-01']);
  });
  it('plantilla sin materia/tema: frontmatter limpio, sin «undefined»', async () => {
    const { newNoteText } = await import('../src/notes/model');
    const now = new Date(2026, 10, 12, 9, 0);
    for (const [m, tm] of [['', ''], ['Cardio', ''], ['', 'ECG']]) {
      const txt = newNoteText(m!, tm!, 'Idea', 'Clase', [], now);
      expect(txt).not.toMatch(/undefined|materia: *\n|tema: *\n|materia: ''|tema: ''/);
      const fm = parseFrontmatter(txt).data;
      expect('materia' in fm).toBe(!!m);
      expect(fm.tema).toBe(tm || undefined);
      expect(fm.fecha).toBe('2026-11-12');
    }
    expect(parseFrontmatter(newNoteText('Cardio', 'ECG', 'Clase', 'Clase', ['ecg'], now)).data).toMatchObject({ materia: 'Cardio', tema: 'ECG', tags: ['ecg'] });
  });
  it('retrocompatible: la bóveda de ejemplo da el mismo árbol y las mismas rutas', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const root = new URL('../examples/boveda/', import.meta.url).pathname;
    const files: string[] = [];
    const walkFs = (d: string) => { for (const n of readdirSync(root + d)) { const p = d ? `${d}/${n}` : n; if (statSync(root + p).isDirectory()) walkFs(p); else if (p.startsWith('notes/') && p.endsWith('.md')) files.push(p); } };
    walkFs('');
    const t = buildTree(files.map(noteMeta));
    expect(t.tree.map((m) => [m.materia, m.temas.map((x) => x.tema)])).toEqual([['Cardiología', ['ECG']]]);
    expect(t.tree[0]!.temas[0]!.notes.map((n) => n.path)).toEqual(['notes/Cardiología/ECG/Clase 1 - ECG básico.md']);
  });
});
