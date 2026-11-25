import { describe, expect, it } from 'vitest';
import es from '../src/i18n/es.json';
import en from '../src/i18n/en.json';
import fr from '../src/i18n/fr.json';
import { PLANS } from '../src/welcome/plans';
import { showLanding } from '../src/welcome/gate';

// Lista negra: nada de formatos, rutas ni detalles de implementación en la presentación.
const BLACK = /\.(md|jsonl|json|ics|apkg|zip|docx)\b|decks\/|notes\/|anki21b|\bv11\b|\bv18\b|zstd|fsrs|opfs|safevault|diario|suma de verificaci|markdown|wikilink|\[\[|q::|archivos? de texto|text files?|b[oó]veda|frontmatter|indexeddb|\.app\/|origen: ia/i;
const NO_MAQUETA = /ejemplo|maqueta|mockup|sample|exemple|\bidea\b/i;

describe('presentación de bienvenida', () => {
  for (const [name, tb] of Object.entries({ es, en, fr }) as [string, Record<string, string>][]) {
    const keys = Object.keys(tb).filter((k) => k.startsWith('bienvenida.'));
    it(`${name}: sin términos técnicos en ${keys.length} claves`, () => {
      expect(keys.length).toBeGreaterThan(100);
      for (const k of keys) {
        expect(BLACK.test(tb[k]!), `${k}: ${tb[k]}`).toBe(false);
        if (k !== 'bienvenida.correo_ph') expect(NO_MAQUETA.test(tb[k]!), `${k}: ${tb[k]}`).toBe(false);
      }
    });
  }
  it('los planes usan claves que existen y solo «Gratis» está disponible', () => {
    const t = es as Record<string, string>;
    for (const p of PLANS) for (const k of [p.name, p.desc, ...p.rows.flat()]) expect(t[k], k).toBeTruthy();
    expect(PLANS.map((p) => [p.id, p.price, p.soon])).toEqual([['gratis', 0, false], ['esencial', 5, true], ['plus', 10, true], ['pro', 20, true]]);
  });
  it('la puerta respeta ?app y ?demo', () => {
    const at = (search: string) => { (globalThis as { location: unknown }).location = { search }; return showLanding(); };
    const prev = (globalThis as { location?: unknown }).location;
    try {
      (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
      expect(at('')).toBe(true);
      expect(at('?app')).toBe(false);
      expect(at('?x=1&demo=1')).toBe(false);
    } finally { (globalThis as { location?: unknown }).location = prev; }
  });
});
