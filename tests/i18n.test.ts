import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import es from '../src/i18n/es.json';
import en from '../src/i18n/en.json';
import fr from '../src/i18n/fr.json';
import { errMsg, firstDayOfWeek, setLang, t, tn } from '../src/i18n';
import { normalizePath } from '../src/vault/paths';
import { parseFrontmatter } from '../src/lib/frontmatter';

const TABLES = { es, en, fr } as Record<'es' | 'en' | 'fr', Record<string, string>>;
const ph = (s = '') => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, String(f));
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?)$/.test(String(f)) ? [p] : [];
  });
}

describe('idiomas', () => {
  it('las tres tablas tienen exactamente las mismas claves', () => {
    const ref = Object.keys(es).sort();
    for (const [name, tb] of Object.entries(TABLES)) {
      const keys = Object.keys(tb).sort();
      expect(ref.filter((k) => !(k in tb)), `faltan en ${name}`).toEqual([]);
      expect(keys.filter((k) => !(k in es)), `sobran en ${name}`).toEqual([]);
      for (const k of ref) expect((tb[k] ?? '').trim() === '' && (TABLES.es[k] ?? '').trim() !== '', `${name}.${k} vacío`).toBe(false);
    }
  });

  it('los marcadores {x} coinciden en los tres idiomas', () => {
    for (const k of Object.keys(es)) for (const name of ['en', 'fr'] as const) expect(ph(TABLES[name][k]), `${name}.${k}`).toBe(ph(TABLES.es[k]));
  });

  it('toda clave usada en src existe', () => {
    const used = new Set<string>();
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\b(?:t|tr|tn)\(\s*'([a-z_]+\.[a-z0-9_.]+)'/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(500);
    const missing = [...used].filter((k) => !(k in es) && !(`${k}.other` in es));
    expect(missing).toEqual([]);
  });

  it('glosario de calificaciones', () => {
    const g = (l: 'es' | 'en' | 'fr') => (setLang(l), [t('design.otra_vez'), t('design.dificil'), t('design.bien'), t('design.facil'), t('today.nuevas'), t('today.aprendiendo'), t('today.vencidas'), t('deck.mazo')]);
    expect(g('en')).toEqual(['Again', 'Hard', 'Good', 'Easy', 'New', 'Learning', 'Due', 'Deck']);
    expect(g('fr')).toEqual(['Encore', 'Difficile', 'Bien', 'Facile', 'Nouvelles', 'En apprentissage', 'À réviser', 'Paquet']);
    expect(g('es')).toEqual(['Otra vez', 'Difícil', 'Bien', 'Fácil', 'Nuevas', 'Aprendiendo', 'Vencidas', 'Mazo']);
  });

  it('plurales, interpolación y semana', () => {
    setLang('en');
    expect(tn('plural.cards', 1)).toBe('1 card');
    expect(tn('plural.cards', 3)).toBe('3 cards');
    expect(t('calendar.estudiar_topic', { topic: 'ECG' })).toBe('Study ECG');
    expect(firstDayOfWeek()).toBe(0);
    setLang('fr');
    expect(tn('plural.cards', 0)).toBe('0 carte');
    expect(tn('plural.cards', 2)).toBe('2 cartes');
    expect(firstDayOfWeek()).toBe(1);
    setLang('xx');
    expect(t('today.hoy')).toMatch(/^⟦.+⟧$/);
    setLang('es');
    expect(tn('plural.days', 1)).toBe('1 día');
  });

  it('errores de la bóveda y del frontmatter se traducen', () => {
    let err: unknown;
    try {
      normalizePath('a/../b');
    } catch (e) {
      err = e;
    }
    setLang('en');
    expect(errMsg(err)).toBe('Path not allowed: a/../b');
    expect(errMsg(new Error('x'))).toBe('x');
    expect(parseFrontmatter('---\ndeck: A\n').errors).toEqual(['Unclosed frontmatter (missing "---")']);
    setLang('es');
    expect(parseFrontmatter('---\n???\n---\n').errors).toEqual(['Línea 2 no válida: "???"']);
  });
});
