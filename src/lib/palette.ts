/** Paleta del sistema (SPEC §7). Valores aproximados; Apple no publica hex garantizados. */
export const PALETTE = {
  azul: ['#007AFF', '#0A84FF'],
  verde: ['#34C759', '#30D158'],
  indigo: ['#5856D6', '#5E5CE6'],
  naranja: ['#FF9500', '#FF9F0A'],
  rosa: ['#FF2D55', '#FF375F'],
  rojo: ['#FF3B30', '#FF453A'],
  morado: ['#AF52DE', '#BF5AE0'],
  turquesa: ['#30B0C7', '#40C8E0'],
  menta: ['#00C7BE', '#63E6E2'],
  amarillo: ['#FFCC00', '#FFD60A'],
} as const satisfies Record<string, readonly [string, string]>;

export type ColorName = keyof typeof PALETTE;
export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[];

export const COLOR_LABEL: Record<ColorName, string> = {
  azul: 'Azul', verde: 'Verde', indigo: 'Índigo', naranja: 'Naranja', rosa: 'Rosa',
  rojo: 'Rojo', morado: 'Morado', turquesa: 'Turquesa', menta: 'Menta', amarillo: 'Amarillo',
};

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Blanco o negro, el que dé más contraste (AA cuando es posible). */
export function readableOn(bg: string): '#FFFFFF' | '#000000' {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#000000') ? '#FFFFFF' : '#000000';
}

export function resolveColor(name: string | null | undefined, dark: boolean): string {
  if (name && name in PALETTE) return PALETTE[name as ColorName][dark ? 1 : 0];
  if (name && /^#[0-9a-f]{6}$/i.test(name)) return name;
  return PALETTE.azul[dark ? 1 : 0];
}

function mix(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => Math.round(v * (1 - k)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`.toUpperCase();
}

/**
 * Relleno con texto legible (AA, 4.5:1): si el blanco no alcanza, se oscurece
 * el color hasta un 20 %; si aun así no alcanza, texto negro sobre el color original.
 */
export function fillFor(bg: string): { bg: string; fg: '#FFFFFF' | '#000000' } {
  for (let k = 0; k <= 0.2001; k += 0.02) {
    const c = k ? mix(bg, k) : bg;
    if (contrast(c, '#FFFFFF') >= 4.5) return { bg: c, fg: '#FFFFFF' };
  }
  return { bg, fg: '#000000' };
}
