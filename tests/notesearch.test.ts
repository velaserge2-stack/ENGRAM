import { describe, expect, it } from 'vitest';
import { createIndex, findHits, fold, snippet, tokenize } from '../src/notes/search';
import { searchCore } from '../src/notes/search-core';

const DOCS = [
  { id: 'notes/Cardio/HTA/a.md', title: 'Hipertensión', body: 'Meta de presión 120/80 mmHg en diabéticos. Ver también 130/80.', materia: 'Cardio', tema: 'HTA', fecha: '2026-11-01' },
  { id: 'notes/Neuro/Serotonina/b.md', title: 'Serotonina', body: 'El receptor 5-HT3 y la 5-HT en migraña. Glucosa 120 mg/dL.', materia: 'Neuro', tema: 'Serotonina', fecha: '2026-10-01' },
  { id: 'notes/Nefro/Ácido/c.md', title: 'Gasometría', body: 'pH 7.4 normal; temperatura 37.5 °C; creatinina 1200.', materia: 'Nefro', tema: 'Ácido', fecha: '' },
];

describe('buscador de notas', () => {
  it('tokens que conservan números y símbolos', () => {
    expect(tokenize('Presión 120/80, pH 7.4 y 5-HT; 37.5 mg/dL.')).toEqual(['presion', '120/80', '120', '80', 'ph', '7.4', '7', '4', 'y', '5-ht', '5', 'ht', '37.5', '37', '5', 'mg/dl', 'mg', 'dl']);
    expect(fold('Ácido ÚRICO')).toBe('acido urico');
  });
  it('busca palabras sin acentos ni mayúsculas y números exactos', () => {
    const ix = createIndex();
    ix.addAll(DOCS);
    const ids = (q: string) => ix.search(q).map((r) => r.id.split('/').pop());
    expect(ids('120/80')).toEqual(['a.md']);
    expect(ids('pH')).toEqual(['c.md']);
    expect(ids('7.4')).toEqual(['c.md']);
    expect(ids('5-HT')).toEqual(['b.md']);
    expect(ids('mg/dL')).toEqual(['b.md']);
    expect(ids('hipertension')).toEqual(['a.md']);
    expect(ids('DIABETICOS')).toEqual(['a.md']); // sin acentos ni mayúsculas
    expect(ids('12').length).toBe(0); // un número no es prefijo de 120 ni de 1200
    expect(ids('120').sort()).toEqual(['a.md', 'b.md']);
    expect(ids('seroto')).toEqual(['b.md']); // las palabras sí admiten prefijo
  });
  it('coincidencias exactas en el texto original y fragmento resaltado', () => {
    const body = DOCS[0]!.body;
    const h = findHits(body, '120/80');
    expect(h).toHaveLength(1);
    expect(body.slice(h[0]!.start, h[0]!.end)).toBe('120/80');
    const b2 = 'Fármacos: diurético y DIURÉTICOS de asa.';
    expect(findHits(b2, 'diuretico').map((x) => b2.slice(x.start, x.end))).toEqual(['diurético', 'DIURÉTICO']);
    expect(findHits('37.5 y 37', '37').map((x) => x.start)).toEqual([7]); // «37» no es «37.5»
    const s = snippet(body, h);
    expect(s.parts.find((p) => p.hit)!.t).toBe('120/80');
  });
  it('500 notas: indexar y buscar es casi instantáneo; filtros y actualización incremental', () => {
    const core = searchCore();
    const words = 'presión arterial diurético insuficiencia cardiaca renal hepática glucosa insulina tiroides'.split(' ');
    const docs = Array.from({ length: 500 }, (_, i) => ({ id: `notes/M${i % 5}/T${i % 7}/n${i}.md`, title: `Nota ${i}`, body: Array.from({ length: 300 }, (_, k) => words[(i + k) % words.length]).join(' ') + (i === 321 ? ' TA 120/80 y pH 7.4' : ''), materia: `M${i % 5}`, tema: `T${i % 7}`, fecha: '' }));
    core.reset(docs);
    const t0 = performance.now();
    const r = core.query('120/80');
    expect(performance.now() - t0).toBeLessThan(150);
    expect(r.map((x) => x.id)).toEqual(['notes/M1/T6/n321.md']);
    expect(core.query('ph 7.4', { materia: 'M0' })).toEqual([]);
    core.upsert({ ...docs[0]!, body: 'ahora dice 120/80' });
    expect(core.query('120/80').length).toBe(2);
    core.remove(docs[0]!.id);
    expect(core.query('120/80').length).toBe(1);
  });
});
