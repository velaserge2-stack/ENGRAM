/**
 * Auditoría etapa 2.1 · src/lib. Cada `it.fails` demuestra un error que EXISTE hoy:
 * la suite sigue en verde mientras el error exista. auditoría: cambiar a it() al corregir.
 */
import { describe, expect, it } from 'vitest';
import { createAutosave } from '../src/lib/autosave';
import { dayKey } from '../src/lib/days';
import { fmtDate, pace } from '../src/lib/exams';
import { parseFrontmatter, stringifyFrontmatter } from '../src/lib/frontmatter';
import { fromICS, occurrences, toICS, type StudyBlock } from '../src/lib/ics';
import { ensureFileId, resolveLink, type LinkIndex } from '../src/lib/links';
import { initial, skip, start } from '../src/lib/pomodoro';
import { mergeSettings } from '../src/lib/settings';
import { MemoryBackend } from '../src/vault/memory';
import { readText } from '../src/vault/util';

const BLOCK: StudyBlock = { uid: 'a@engrama', start: Date.UTC(2026, 10, 12, 9), end: Date.UTC(2026, 10, 12, 10), title: 't', subject: '', note: '', rrule: '', until: '', done: [], alarmMin: null };

describe('auditoría · links', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('un vínculo de etiqueta creado desde el selector (engrama://tag/ecg) se resuelve', () => {
    const idx: LinkIndex = { decks: [], notes: [], topics: [], tags: [{ kind: 'tag', path: 'tag:ecg', name: '#ecg' }] };
    // src/ui/links.tsx:83 usa key = t.path.slice(4) = 'ecg'
    expect(resolveLink('engrama://tag/ecg', idx).target).not.toBeNull();
  });
  // auditoría: cambiar a it() al corregir
  it.fails('ensureFileId no pierde líneas de frontmatter que el parser no entiende (escalares de bloque, mapas anidados)', async () => {
    const v = new MemoryBackend();
    await v.write('notes/a.md', '---\ndescripcion: >\n  Texto largo\nprops:\n  a: 1\n---\n# Hola\n');
    await ensureFileId(v, 'notes/a.md', new Set());
    const out = await readText(v, 'notes/a.md');
    expect(out).toContain('Texto largo');
  });
  // auditoría: corregido (plan 1)
  it('ensureFileId no sustituye la nota por un archivo vacío si la lectura falla', async () => {
    class Flaky extends MemoryBackend {
      fail = false;
      override async read(p: string) { if (this.fail) throw new Error('lectura transitoria'); return super.read(p); }
    }
    const v = new Flaky();
    await v.write('notes/a.md', '# Mi nota importante\n');
    v.fail = true;
    await ensureFileId(v, 'notes/a.md', new Set()).catch(() => {});
    v.fail = false;
    expect(await readText(v, 'notes/a.md')).toContain('Mi nota importante');
  });
});

describe('auditoría · frontmatter', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('ida y vuelta con una barra invertida no duplica la barra', () => {
    const data = { ruta: 'C:\\apuntes' };
    expect(parseFrontmatter(stringifyFrontmatter(data, '')).data).toEqual(data);
  });
  // auditoría: cambiar a it() al corregir
  it.fails('reescribir no altera números con forma de texto (1.0, 007)', () => {
    const doc = parseFrontmatter('---\nversion: 1.0\ncodigo: 007\n---\n');
    const out = stringifyFrontmatter(doc.data, '');
    expect(out).toContain('version: 1.0');
    expect(out).toContain('codigo: 007');
  });
  // auditoría: cambiar a it() al corregir
  it.fails('un valor que empieza con # se escribe entrecomillado (en YAML estándar `# …` es comentario)', () => {
    expect(stringifyFrontmatter({ color: '#FF9500' }, '')).toContain('"#FF9500"');
  });
});

describe('auditoría · ics', () => {
  // auditoría: corregido (plan 13)
  it('un título con «\\n» literal (ruta C:\\nuevo) sobrevive a exportar e importar', () => {
    const b = { ...BLOCK, title: 'C:\\nuevo' };
    expect(fromICS(toICS([b]))[0]!.title).toBe('C:\\nuevo');
  });
  // auditoría: corregido (plan 13)
  it('RRULE con INTERVAL=2 no se expande cada semana', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:20261102T090000\nDTEND:20261102T100000\nSUMMARY:Quincenal\nRRULE:FREQ=WEEKLY;INTERVAL=2\nEND:VEVENT\nEND:VCALENDAR';
    const [b] = fromICS(ics, 'ext');
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    expect(occurrences(b!, '2026-11-01', '2026-11-30', day).length).toBe(3); // 2, 16 y 30; hoy da 5
  });
});

describe('auditoría · settings', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('una zona horaria inválida en settings.json no rompe dayKey', () => {
    const s = mergeSettings({ timeZone: 'Marte/Olympus' });
    expect(() => dayKey(Date.now(), s.timeZone)).not.toThrow();
  });
  // auditoría: cambiar a it() al corregir
  it.fails('pomo con valores de tipo o rango inválido se corrige (work "x", every 0)', () => {
    const s = mergeSettings({ pomo: { work: 'x', every: 0 } });
    expect(typeof s.pomo.work).toBe('number');
    expect(s.pomo.every).toBeGreaterThan(0);
  });
});

describe('auditoría · exámenes', () => {
  const base = { today: '2026-11-13', created: '2026-10-01', finalDays: 7, newLeft: 50, newPerDay: new Map([['2026-11-12', 10], ['2026-11-11', 10], ['2026-11-10', 10], ['2026-11-09', 10]]), firstActivity: '2026-11-05' };
  // auditoría: cambiar a it() al corregir
  it.fails('pace con fecha de examen vacía o inválida no lanza', () => {
    expect(() => pace({ ...base, examDate: '' })).not.toThrow();
  });
  // auditoría: cambiar a it() al corregir
  it.fails('fmtDate con fecha inválida no lanza RangeError', () => {
    expect(() => fmtDate('')).not.toThrow();
  });
});

describe('auditoría · pomodoro', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('saltar tras acortar el trabajo en Ajustes no registra minutos negativos', () => {
    const cfg = { work: 25, short: 5, long: 15, every: 4 };
    const s = start(initial(cfg), 0);
    const { session } = skip(s, { ...cfg, work: 10 }, 60_000);
    expect(session!.minutes).toBeGreaterThanOrEqual(0);
  });
});

describe('auditoría · autosave', () => {
  // auditoría: corregido (plan 9)
  it('flush informa del fallo de guardado (hoy solo console.error y la promesa se cumple)', async () => {
    const a = createAutosave<string>(async () => { throw new Error('disco lleno'); }, 10, null);
    const quiet = console.error;
    console.error = () => {};
    a.schedule('x');
    try { await expect(a.flush()).rejects.toThrow('disco lleno'); } finally { console.error = quiet; a.dispose(); }
  });
});
