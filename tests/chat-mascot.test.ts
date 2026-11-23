// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, h } from 'preact';
import { Mascot, MASCOT_NAMES } from '../src/chat/mascot';

const STATES = ['idle', 'listening', 'thinking', 'responding', 'error'] as const;

describe('Mascot', () => {
  it.each(STATES)('renderiza %s: decorativa, sin imágenes ni enlaces', (s) => {
    const box = document.createElement('div');
    render(h(Mascot, { state: s, size: 72 }), box);
    const svg = box.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('data-state')).toBe(s);
    expect(svg.getAttribute('width')).toBe('72');
    expect(box.querySelector('image, script, foreignObject, use, a')).toBeNull();
    expect(box.innerHTML).not.toMatch(/href|http|on\w+=|javascript:/i);
    expect(svg.textContent).toBe('');
  });
  it('tamaño por defecto 44 y estado idle', () => {
    const box = document.createElement('div');
    render(h(Mascot, { size: undefined }), box);
    expect(box.querySelector('svg')!.getAttribute('width')).toBe('44');
    expect(box.querySelector('svg')!.getAttribute('data-state')).toBe('idle');
  });
  it('3 nombres', () => expect(MASCOT_NAMES).toHaveLength(3));
});
