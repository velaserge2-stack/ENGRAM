// Prompt 21 · 3b (cuello #8): refsRewriter (una pasada por forma) == reducir rewriteNoteRefs en orden.
import { describe, expect, it } from 'vitest';
import { refsRewriter, rewriteNoteRefs } from '../src/notes/move';

/** Generador pseudoaleatorio con semilla (mulberry32): la prueba es reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('refsRewriter', () => {
  it('equivale a la reducción en orden (300 casos aleatorios con prefijos, espacios, acentos y anclas)', () => {
    const r = rng(20261113);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]!;
    const names = ['Nota', 'Nota 2', 'Nota2', 'Árbol bronquial', 'ECG (básico)', 'a.b', 'x+y', 'Cardio', 'Cardio extra'];
    const dirs = ['notes/Cardio', 'notes/Cardio/ECG', 'notes/Neumo', 'notes', 'notes/Árbol y más'];
    for (let c = 0; c < 300; c++) {
      // movidas sin cadenas (ningún destino es origen de otra), como produce moveNotes
      const froms = new Set<string>();
      const moved: [string, string][] = [];
      for (let i = 0; i < 1 + Math.floor(r() * 6); i++) {
        const from = `${pick(dirs)}/${pick(names)}.md`;
        if (froms.has(from)) continue;
        froms.add(from);
        moved.push([from, `notes/Destino ${c}/${from.split('/').pop()}`]);
      }
      const refs: string[] = [];
      for (let i = 0; i < 12; i++) {
        const p = `${pick(dirs)}/${pick(names)}.md`;
        const a = p.replace(/\.md$/, '');
        refs.push(pick([
          `[[${a}]]`, `[[${a.replace(/^notes\//, '')}]]`, `[[${a}.md|alias]]`, `[[${a}#ancla]]`, `[[${a.replace(/^notes\//, '')}.md]]`,
          `[t](${p})`, `[t](${encodeURI(p)}#x)`, `<!-- src: ${p}#p3 -->`, `<!--src:${p} -->`, `[[${pick(names)}]]`, `texto ${p} suelto`,
        ]));
      }
      const text = refs.join(' · ');
      const want = moved.reduce((acc, [a, b]) => rewriteNoteRefs(acc, a, b), text);
      expect(refsRewriter(moved)(text), JSON.stringify({ moved, text })).toBe(want);
    }
  });
  it('sin movidas o sin referencias: el mismo texto', () => {
    expect(refsRewriter([])('[[notes/A/B]]')).toBe('[[notes/A/B]]');
    expect(refsRewriter([['notes/A/B.md', 'notes/C/B.md']])('nada que ver')).toBe('nada que ver');
  });
});
