import { describe, expect, it } from 'vitest';
import { fromICS, occurrences, toICS, type StudyBlock } from '../src/lib/ics';

const B: StudyBlock = { uid: 'b1@engrama', start: Date.UTC(2026, 10, 12, 0, 0), end: Date.UTC(2026, 10, 12, 1, 0), title: 'Cardio; repaso, ECG', subject: 'Cardiología', note: 'Línea 1\nLínea 2', rrule: 'WEEKLY', until: '2026-12-31', done: ['2026-11-12'], alarmMin: 15 };

describe('iCalendar', () => {
  it('ida y vuelta conserva todo', () => {
    const t = toICS([B]);
    expect(t).toContain('BEGIN:VALARM');
    expect(t).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z');
    expect(t.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(fromICS(t)[0]).toEqual(B);
  });
  it('importa eventos de otros calendarios (plegado, hora local, sin fin)', () => {
    const ext = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=America/Monterrey:20261113T080000\nSUMMARY:Clase de\n  anatomía\nEND:VEVENT\nEND:VCALENDAR';
    const [e] = fromICS(ext, 'horario');
    expect(e!.title).toBe('Clase de anatomía');
    expect(e!.end - e!.start).toBe(3600_000);
    expect(e!.readonly).toBe(true);
  });
  it('repeticiones', () => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const occ = occurrences({ ...B, until: '' }, '2026-11-01', '2026-11-30', day);
    expect(occ.map((o) => o.date)).toEqual(['2026-11-12', '2026-11-19', '2026-11-26']);
  });
});

import { buildLinkIndex, ensureFileId, makeUri, resolveLink, studyFilter, type LinkIndex } from '../src/lib/links';
import { MemoryBackend } from '../src/vault/memory';
import { parseFrontmatter } from '../src/lib/frontmatter';
import { readText } from '../src/vault/util';

describe('vínculos del calendario', () => {
  const IDX: LinkIndex = {
    decks: [{ kind: 'deck', path: 'decks/Cardiología.md', name: 'Cardiología', id: 'k7f3q' }, { kind: 'deck', path: 'decks/Neuro/EVC.md', name: 'Neuro/EVC' }],
    notes: [{ kind: 'note', path: 'notes/Cardio/ECG/Clase 3 renombrada.md', name: 'Clase 3 renombrada', id: 'n1abc' }, { kind: 'note', path: 'notes/Cardio/ECG/Sin id.md', name: 'Sin id' }],
    topics: [{ kind: 'topic', path: 'decks/Neuro/', name: 'Neuro' }],
    tags: [{ kind: 'tag', path: 'tag:ecg', name: '#ecg' }],
  };
  it('con id (sobrevive al renombrado), sin id (nombre o ruta) y roto', () => {
    expect(resolveLink('engrama://note/n1abc', IDX).target?.path).toBe('notes/Cardio/ECG/Clase 3 renombrada.md');
    expect(resolveLink('engrama://deck/k7f3q', IDX).label).toBe('Cardiología');
    expect(resolveLink(makeUri('deck', 'Neuro/EVC'), IDX).target?.path).toBe('decks/Neuro/EVC.md');
    expect(resolveLink(makeUri('note', 'notes/Cardio/ECG/Sin id.md'), IDX).target?.name).toBe('Sin id');
    const broken = resolveLink('engrama://note/zzzzz', IDX);
    expect(broken.target).toBeNull();
    expect(broken.label).toBe('zzzzz');
    expect(studyFilter(['engrama://deck/k7f3q', makeUri('topic', 'Neuro'), makeUri('tag', '#ecg'), 'engrama://note/n1abc'].map((u) => resolveLink(u, IDX)))).toBe('decks/Cardiología.md|decks/Neuro/|tag:ecg');
  });
  it('el id se genera solo la primera vez y conserva el archivo', async () => {
    const v = new MemoryBackend();
    await v.write('notes/a/b/c.md', '---\nmateria: a\n---\n# Hola\n');
    await v.write('notes/a/b/sin.md', '# Sin frontmatter\n');
    const id = await ensureFileId(v, 'notes/a/b/c.md', new Set());
    expect(await ensureFileId(v, 'notes/a/b/c.md', new Set())).toBe(id);
    expect(parseFrontmatter(await readText(v, 'notes/a/b/c.md'))).toMatchObject({ data: { materia: 'a', id }, body: '# Hola\n' });
    await ensureFileId(v, 'notes/a/b/sin.md', new Set());
    expect(parseFrontmatter(await readText(v, 'notes/a/b/sin.md')).body).toBe('# Sin frontmatter\n');
    const idx = await buildLinkIndex(v, [{ path: 'decks/X/Y.md', full: 'X/Y', folder: 'X', tags: ['t'], data: {} }]);
    expect(idx.notes.find((n) => n.path.endsWith('c.md'))?.id).toBe(id);
    expect(idx.topics.map((t) => t.path)).toEqual(['decks/X/']);
  });
  it('X-ENGRAMA-LINK y propiedades desconocidas: ida y vuelta', () => {
    const b: StudyBlock = { ...B, uid: 'v1', rrule: '', until: '', links: ['engrama://deck/k7f3q', 'engrama://note/n1abc'], extra: ['LOCATION:Aula 3', 'X-OTRA;P=1:valor'] };
    const t = toICS([b], 'x', (u) => resolveLink(u, IDX).label);
    expect(t).toContain('X-ENGRAMA-LINK:engrama://deck/k7f3q');
    expect(t).toContain('DESCRIPTION:Línea 1\\nLínea 2\\n\\nVínculos: Cardiología\\, Clase 3 renombrada');
    const back = fromICS(t)[0]!;
    expect(back.links).toEqual(b.links);
    expect(back.note).toBe('Línea 1\nLínea 2');
    expect(back.extra).toEqual(['LOCATION:Aula 3', 'X-OTRA;P=1:valor']);
  });
  it('un .ics antiguo sin vínculos se importa igual', () => {
    const old = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261112T000000Z\r\nDTEND:20261112T010000Z\r\nSUMMARY:Viejo\r\nDESCRIPTION:Nota\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const [e] = fromICS(old);
    expect(e).toMatchObject({ title: 'Viejo', note: 'Nota' });
    expect(e!.links).toBeUndefined();
  });
});
