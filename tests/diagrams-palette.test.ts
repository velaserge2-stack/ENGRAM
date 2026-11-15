import { describe, expect, it } from 'vitest';
import { contrast } from '../src/lib/palette';
import { diagTokens, inkOn, PALETTE_DARK, PALETTE_LIGHT } from '../src/diagrams/palette';

describe('paleta de diagramas', () => {
  it('8 colores con tinta legible ≥ 4.5:1 en claro y oscuro', () => {
    expect(PALETTE_LIGHT).toHaveLength(8); expect(PALETTE_DARK).toHaveLength(8);
    for (const hex of [...PALETTE_LIGHT, ...PALETTE_DARK]) expect(contrast(hex, inkOn(hex))).toBeGreaterThanOrEqual(4.5);
  });
  it('tokens CSS esperados', () => {
    expect(diagTokens('light')['--diag-c1']).toBe(PALETTE_LIGHT[0]);
    expect(Object.keys(diagTokens('dark'))).toHaveLength(16);
  });
});
