// @vitest-environment happy-dom
// Nota: vite.config.ts solo incluye `tests/**/*.test.ts`, por eso este archivo es .ts y usa `h()` en lugar de JSX.
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { DiagramView } from '../src/diagrams/view';
import { mountDiagrams } from '../src/diagrams/mount';

function mount(text: string, kind: 'mapa' | 'flujo' | 'diagrama') {
  const el = document.createElement('div');
  render(h(DiagramView, { text, kind }), el);
  return el;
}

describe('DiagramView', () => {
  it('mapa: árbol con un solo svg y niveles por clase', () => {
    const el = mount('Raíz\n- Uno\n  - Dos', 'mapa');
    expect(el.querySelectorAll('svg')).toHaveLength(1);
    expect(el.querySelector('[role=tree]')).not.toBeNull();
    const items = el.querySelectorAll('[role=treeitem]');
    expect(items).toHaveLength(3);
    expect(el.querySelector('.diag-root')?.textContent).toBe('Raíz');
    expect(el.querySelector('.diag-l1')?.textContent).toBe('Uno');
    expect(el.querySelector('.diag-l2')?.textContent).toBe('Dos');
    expect(items[2]?.getAttribute('aria-level')).toBe('3');
    expect(el.querySelectorAll('path.diag-edge').length).toBe(2);
  });

  it('flujo: formas, lista alternativa y etiqueta', () => {
    const el = mount('(Inicio) --> [Triaje] --> {¿Inestable?}\n{¿Inestable?} -- sí --> [Reanimación]', 'flujo');
    expect(el.querySelector('.diag-round')).not.toBeNull();
    expect(el.querySelector('.diag-decision')).not.toBeNull();
    expect(el.querySelectorAll('svg')).toHaveLength(1);
    const li = Array.from(el.querySelectorAll('ul[role=list] li')).map((x) => x.textContent);
    expect(li).toContain('Inicio → Triaje');
    expect(li).toContain('¿Inestable? → Reanimación (sí)');
    expect(el.querySelector('.diag-label')?.textContent).toBe('sí');
  });

  it('el texto nunca se interpreta como HTML', () => {
    const el = mount('<img src=x onerror=alert(1)>\n- **fuerte** y *suave* y [[Otra nota]]', 'mapa');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('strong')?.textContent).toBe('fuerte');
    expect(el.querySelector('em')?.textContent).toBe('suave');
    expect(el.querySelector('.diag-wiki')?.getAttribute('data-wiki')).toBe('Otra nota');
    expect(el.querySelector('.diag-root')?.textContent).toContain('<img');
    // style solo con números generados
    for (const n of Array.from(el.querySelectorAll<HTMLElement>('.diag-node'))) expect(n.getAttribute('style')).toMatch(/^[\w\s:.,()\-;]+$/);
  });

  it('más de 300 nodos: aviso y texto, sin acomodar', () => {
    const text = 'Raíz\n' + Array.from({ length: 320 }, (_, i) => `- n${i}`).join('\n');
    const el = mount(text, 'mapa');
    expect(el.querySelector('.diag-warn')).not.toBeNull();
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('pre')?.textContent).toBe(text);
  });
});

describe('mountDiagrams', () => {
  it('monta los diag-host y desmonta; ignora tipos desconocidos', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="diag-host" data-kind="mapa" data-src="A&#10;- B"><pre><code>A</code></pre></div>'
      + '<div class="diag-host" data-kind="otro" data-src="x"><pre><code>x</code></pre></div>';
    const off = mountDiagrams(root);
    const [a, b] = Array.from(root.querySelectorAll('.diag-host'));
    expect(a?.querySelector('svg')).not.toBeNull();
    expect(a?.querySelector('pre')).toBeNull();
    expect(b?.querySelector('pre')).not.toBeNull();
    mountDiagrams(root); // idempotente
    expect(a?.querySelectorAll('svg')).toHaveLength(1);
    off();
    expect(a?.querySelector('svg')).toBeNull();
  });
});
