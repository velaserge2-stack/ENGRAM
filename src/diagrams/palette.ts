// Paleta de color por nodo/flecha (CONTRATO §P22.4). `diagram.css` define los mismos valores como tokens.
import { contrast } from '../lib/palette';

export const PALETTE_LIGHT: readonly string[] = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#0090ff', '#8e4ec6', '#d6409f'];
export const PALETTE_DARK: readonly string[] = ['#c62a2f', '#cc4e00', '#e2a336', '#218358', '#0d7d6c', '#0b68cb', '#6e3f99', '#b2357f'];

/** Blanco o negro: el de mayor contraste (siempre ≥ 4,5:1 sobre cualquier color). */
export function inkOn(bg: string): '#ffffff' | '#000000' {
  return contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000';
}

/** Tokens CSS esperados (`--diag-cN`, `--diag-cN-fg`) por tema, para comparar con `diagram.css`. */
export function diagTokens(mode: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  (mode === 'dark' ? PALETTE_DARK : PALETTE_LIGHT).forEach((hex, i) => {
    out[`--diag-c${i + 1}`] = hex;
    out[`--diag-c${i + 1}-fg`] = inkOn(hex);
  });
  return out;
}
