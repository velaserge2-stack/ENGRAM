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
    // LOCATION pasó a ser el campo «lugar» (F16): se conserva igual en la ida y vuelta
    expect(back.extra).toEqual(['X-OTRA;P=1:valor']);
    expect(back.location).toBe('Aula 3');
    expect(toICS([back])).toContain('LOCATION:Aula 3');
  });
  it('un .ics antiguo sin vínculos se importa igual', () => {
    const old = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261112T000000Z\r\nDTEND:20261112T010000Z\r\nSUMMARY:Viejo\r\nDESCRIPTION:Nota\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const [e] = fromICS(old);
    expect(e).toMatchObject({ title: 'Viejo', note: 'Nota' });
    expect(e!.links).toBeUndefined();
  });
});

describe('calendario con horas (F16)', () => {
  const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const at = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
  const base = { title: 'Clase', subject: '', note: '', until: '', done: [] as string[], alarmMin: null };

  it('clase semanal los lunes 8–10 en hora flotante, borrar solo un lunes (EXDATE)', () => {
    const b: StudyBlock = { ...base, uid: 'c1', start: at(2026, 11, 16, 8), end: at(2026, 11, 16, 10), rrule: 'WEEKLY', byday: ['MO'], kind: 'clase', floating: true, location: 'Aula 3', exdate: ['2026-11-23'] };
    const t = toICS([b]);
    expect(t).toContain('DTSTART:20261116T080000\r\n'); // sin «Z»: sigue a las 8:00 en cualquier zona
    expect(t).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(t).toContain('EXDATE:20261123T080000');
    expect(t).toContain('X-ENGRAMA-KIND:clase');
    const back = fromICS(t)[0]!;
    expect(back).toMatchObject({ floating: true, kind: 'clase', byday: ['MO'], exdate: ['2026-11-23'], location: 'Aula 3' });
    expect(new Date(back.start).getHours()).toBe(8);
    const occ = occurrences(back, '2026-11-01', '2026-12-14', day);
    expect(occ.map((o) => o.date)).toEqual(['2026-11-16', '2026-11-30', '2026-12-07', '2026-12-14']);
    expect(occ.every((o) => new Date(o.start).getHours() === 8 && o.end - o.start === 2 * 3600_000)).toBe(true);
  });
  it('semanal con varios días, mensual (salta meses sin ese día) y UNTIL', () => {
    const w: StudyBlock = { ...base, uid: 'w', start: at(2026, 11, 2, 17), end: at(2026, 11, 2, 18), rrule: 'WEEKLY', byday: ['MO', 'WE'], floating: true, until: '2026-11-11' };
    expect(occurrences(w, '2026-11-01', '2026-11-30', day).map((o) => o.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
    const m: StudyBlock = { ...base, uid: 'm', start: at(2026, 1, 31, 9), end: at(2026, 1, 31, 10), rrule: 'MONTHLY', floating: true };
    expect(occurrences(m, '2026-01-01', '2026-05-31', day).map((o) => o.date)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    expect(fromICS(toICS([m]))[0]!.rrule).toBe('MONTHLY');
  });
  it('todo el día y eventos antiguos en UTC siguen igual', () => {
    const a: StudyBlock = { ...base, uid: 'a', start: at(2026, 12, 1, 0), end: at(2026, 12, 2, 0), rrule: '', allDay: true, kind: 'examen' };
    const t = toICS([a]);
    expect(t).toContain('DTSTART;VALUE=DATE:20261201');
    expect(fromICS(t)[0]).toMatchObject({ allDay: true, kind: 'examen', start: a.start });
    const old = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:o\r\nDTSTART:20261112T000000Z\r\nDTEND:20261112T010000Z\r\nSUMMARY:Viejo\r\nRRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const e = fromICS(old)[0]!;
    expect(e.floating).toBeUndefined();
    expect(e.start).toBe(Date.UTC(2026, 10, 12));
    expect(toICS([e])).toContain('DTSTART:20261112T000000Z'); // se reescribe igual que antes
    expect(toICS([e])).toContain('UNTIL=20261231T235959Z');
  });
});

import { deleteOccurrence, editOccurrence } from '../src/lib/calendar-edit';
describe('solo este día / toda la serie', () => {
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();
  const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const serie: StudyBlock = { uid: 's', title: 'Clase', subject: '', note: '', until: '', done: [], alarmMin: null, start: at(2026, 11, 16, 8), end: at(2026, 11, 16, 10), rrule: 'WEEKLY', byday: ['MO'], floating: true };
  it('borrar solo un día deja el resto de la serie', () => {
    const r = deleteOccurrence([serie], 's', '2026-11-23', 'one');
    expect(occurrences(r[0]!, '2026-11-16', '2026-11-30', day).map((o) => o.date)).toEqual(['2026-11-16', '2026-11-30']);
    expect(deleteOccurrence([serie], 's', '2026-11-23', 'series')).toEqual([]);
  });
  it('editar solo un día crea una entrada suelta y excluye la fecha de la serie', () => {
    const moved = { ...serie, start: at(2026, 11, 23, 12), end: at(2026, 11, 23, 13), title: 'Clase movida' };
    const r = editOccurrence([serie], 's', '2026-11-23', moved, 'one', () => 'n1');
    expect(r[0]!.exdate).toEqual(['2026-11-23']);
    expect(r[1]).toMatchObject({ uid: 'n1', rrule: '', title: 'Clase movida', start: at(2026, 11, 23, 12) });
  });
  it('editar toda la serie cambia la hora en todas las ocurrencias', () => {
    const r = editOccurrence([serie], 's', '2026-11-30', { ...serie, start: at(2026, 11, 30, 9), end: at(2026, 11, 30, 11) }, 'series');
    const occ = occurrences(r[0]!, '2026-11-16', '2026-11-30', day);
    expect(occ.map((o) => new Date(o.start).getHours())).toEqual([9, 9, 9]);
    expect(day(r[0]!.start)).toBe('2026-11-16'); // la serie sigue empezando el mismo día
  });
});

describe('plan 13: calendario', () => {
  const cal = (...ev: string[]) => ['BEGIN:VCALENDAR', ...ev.flatMap((e) => ['BEGIN:VEVENT', ...e.split('\n'), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const day = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  it('COUNT, YEARLY y BYDAY con INTERVAL', () => {
    const [c] = fromICS(cal('UID:c\nDTSTART:20261102T090000\nDTEND:20261102T100000\nRRULE:FREQ=DAILY;COUNT=3'));
    expect(occurrences(c!, '2026-11-01', '2026-11-30', day).map((o) => o.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    const [y] = fromICS(cal('UID:y\nDTSTART:20000315T090000\nDTEND:20000315T100000\nRRULE:FREQ=YEARLY'));
    expect(occurrences(y!, '2026-01-01', '2027-12-31', day).map((o) => o.date)).toEqual(['2026-03-15', '2027-03-15']);
    const [w] = fromICS(cal('UID:w\nDTSTART:20261102T090000\nDTEND:20261102T100000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'));
    expect(occurrences(w!, '2026-11-01', '2026-11-22', day).map((o) => o.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18']);
    expect(toICS([w!])).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
  });
  it('RECURRENCE-ID: UID propio en memoria, el de la serie al exportar; sin EXDATE añadido', () => {
    const bs = fromICS(cal('UID:s\nDTSTART:20261102T090000\nDTEND:20261102T100000\nRRULE:FREQ=WEEKLY', 'UID:s\nRECURRENCE-ID:20261109T090000\nDTSTART:20261109T120000\nDTEND:20261109T130000'));
    expect(bs.map((b) => b.uid)).toEqual(['s', 's#2026-11-09']);
    const out = toICS(bs);
    expect(out.match(/^UID:s$/gm)).toHaveLength(2);
    expect(out).toContain('RECURRENCE-ID:20261109T090000');
    expect(out).not.toContain('EXDATE');
  });
  it('TRIGGER con semanas y horas; zona inexistente → hora local', () => {
    const [a] = fromICS(cal('UID:a\nDTSTART:20261110T090000\nBEGIN:VALARM\nTRIGGER:-P1W\nEND:VALARM'));
    expect(a!.alarmMin).toBe(10080);
    const [h] = fromICS(cal('UID:h\nDTSTART:20261110T090000\nBEGIN:VALARM\nTRIGGER:-PT1H30M\nEND:VALARM'));
    expect(h!.alarmMin).toBe(90);
    const [z] = fromICS(cal('UID:z\nDTSTART;TZID=Nada/Inexistente:20261110T090000'));
    expect(z!.start).toBe(new Date(2026, 10, 10, 9).getTime());
  });
});
