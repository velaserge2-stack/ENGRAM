/**
 * Atajos de teclado, clicker y mando (Prompt 5 · E). Configurables en Ajustes → Atajos y
 * guardados en `.app/atajos.json`. Puro (sin DOM global) para poder probarlo.
 *
 * Formato de una tecla: modificadores `mod+` (⌘ o Ctrl), `alt+`, `shift+` (solo con letras o
 * teclas con nombre) y la tecla (`a`, `1`, `?`, `Space`, `Enter`, `ArrowLeft`, `PageDown`…).
 * Secuencias con espacio: `g h` (G y luego H). Mando: índices del «Standard Gamepad».
 */
export type Scope = 'global' | 'study' | 'sim' | 'ink' | 'editor';
export interface ActionDef { id: string; scope: Scope; keys: string[]; pad?: number[] }

export const ACTIONS: ActionDef[] = [
  // globales
  { id: 'global.palette', scope: 'global', keys: ['mod+k', 'mod+p'] },
  { id: 'global.files', scope: 'global', keys: ['mod+o'] },
  { id: 'global.find', scope: 'global', keys: ['mod+f'] },
  { id: 'global.newNote', scope: 'global', keys: ['mod+n'] },
  { id: 'global.newCard', scope: 'global', keys: ['mod+shift+n'] },
  { id: 'global.goHoy', scope: 'global', keys: ['g h'] },
  { id: 'global.goMazos', scope: 'global', keys: ['g m'] },
  { id: 'global.goNotas', scope: 'global', keys: ['g n'] },
  { id: 'global.goCalendario', scope: 'global', keys: ['g c'] },
  { id: 'global.goSimulacros', scope: 'global', keys: ['g s'] },
  { id: 'global.help', scope: 'global', keys: ['?'] },
  // repaso
  { id: 'study.show', scope: 'study', keys: ['Space', 'Enter', 'mod+Enter'] },
  { id: 'study.advance', scope: 'study', keys: ['PageDown'], pad: [0] }, // mostrar respuesta o «Bien»
  { id: 'study.again', scope: 'study', keys: ['1'], pad: [1] },
  { id: 'study.hard', scope: 'study', keys: ['2'], pad: [2] },
  { id: 'study.good', scope: 'study', keys: ['3'] },
  { id: 'study.easy', scope: 'study', keys: ['4'], pad: [3] },
  { id: 'study.undo', scope: 'study', keys: ['z', 'mod+z'], pad: [9] },
  { id: 'study.edit', scope: 'study', keys: ['e'] },
  { id: 'study.bury', scope: 'study', keys: ['s'] },
  { id: 'study.mark', scope: 'study', keys: ['*'] },
  { id: 'study.flag', scope: 'study', keys: ['f'] },
  { id: 'study.exit', scope: 'study', keys: ['Escape'], pad: [8] },
  // simulacros
  ...['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ id: `sim.opt${k.toUpperCase()}`, scope: 'sim' as const, keys: [k, String(i + 1)] })),
  { id: 'sim.next', scope: 'sim', keys: ['j', 'ArrowRight'], pad: [15, 13] },
  { id: 'sim.prev', scope: 'sim', keys: ['k', 'ArrowLeft'], pad: [14, 12] },
  { id: 'sim.mark', scope: 'sim', keys: ['m'] },
  // tinta (PDF y notas)
  { id: 'ink.pen', scope: 'ink', keys: ['p'] },
  { id: 'ink.highlighter', scope: 'ink', keys: ['h'] },
  { id: 'ink.eraser', scope: 'ink', keys: ['e'] },
  { id: 'ink.undo', scope: 'ink', keys: ['mod+z'] },
  { id: 'ink.redo', scope: 'ink', keys: ['mod+shift+z'] },
  // editor de notas (Prompt 17; ⌘K es la paleta y ⌘⇧T lo reserva Safari)
  { id: 'editor.bold', scope: 'editor', keys: ['mod+b'] },
  { id: 'editor.italic', scope: 'editor', keys: ['mod+i'] },
  { id: 'editor.underline', scope: 'editor', keys: ['mod+u'] },
  { id: 'editor.strike', scope: 'editor', keys: ['mod+shift+x'] },
  { id: 'editor.highlight', scope: 'editor', keys: ['mod+shift+h'] },
  { id: 'editor.link', scope: 'editor', keys: ['mod+shift+k'] },
  { id: 'editor.h1', scope: 'editor', keys: ['mod+alt+1'] },
  { id: 'editor.h2', scope: 'editor', keys: ['mod+alt+2'] },
  { id: 'editor.h3', scope: 'editor', keys: ['mod+alt+3'] },
  { id: 'editor.up', scope: 'editor', keys: ['mod+alt+ArrowUp'] },
  { id: 'editor.down', scope: 'editor', keys: ['mod+alt+ArrowDown'] },
  { id: 'editor.undo', scope: 'editor', keys: ['mod+z'] },
  { id: 'editor.redo', scope: 'editor', keys: ['mod+shift+z'] },
  { id: 'editor.fold', scope: 'editor', keys: ['mod+alt+b'] },
];

/** Atajos del sistema y de Safari que nunca se asignan. */
export const RESERVED = ['mod+q', 'mod+w', 'mod+t', 'mod+r', 'mod+l', 'mod+c', 'mod+v', 'mod+x', 'mod+a', 'mod+tab', 'mod+Space', 'mod+h', 'mod+m', 'mod+shift+t'];

export interface KeyConfig { keys: Record<string, string[]>; pad: Record<string, number[]>; spaceGood: boolean; sound: boolean }
export const KEYMAP_PATH = '.app/atajos.json';
export const defaultConfig = (): KeyConfig => ({ keys: {}, pad: {}, spaceGood: false, sound: false });

export function parseConfig(text: string): KeyConfig {
  try {
    const c = JSON.parse(text) as Partial<KeyConfig>;
    const ok = (v: unknown): v is Record<string, unknown[]> => !!v && typeof v === 'object' && !Array.isArray(v);
    return {
      keys: ok(c.keys) ? Object.fromEntries(Object.entries(c.keys).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).map(String)])) : {},
      pad: ok(c.pad) ? Object.fromEntries(Object.entries(c.pad).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).map(Number).filter(Number.isInteger)])) : {},
      spaceGood: !!c.spaceGood, sound: !!c.sound,
    };
  } catch {
    return defaultConfig();
  }
}

/** Teclas efectivas de una acción (las personalizadas reemplazan a las de fábrica). */
export function keysOf(cfg: KeyConfig, id: string): string[] {
  return cfg.keys[id] ?? ACTIONS.find((a) => a.id === id)?.keys ?? [];
}
export function padOf(cfg: KeyConfig, id: string): number[] {
  return cfg.pad[id] ?? ACTIONS.find((a) => a.id === id)?.pad ?? [];
}

const NAMED: Record<string, string> = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };
/** Nombre normalizado de una pulsación (`mod+shift+n`, `Space`, `?`, `PageDown`…). */
export function bindingOf(e: { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string {
  let k = NAMED[e.key] ?? e.key;
  // con ⌥ el Mac cambia la letra (⌥1 = «¡», ⌥B = «∫»): se usa la tecla física
  if (e.altKey && e.code && /^(Digit|Key)[0-9A-Z]$/.test(e.code)) k = e.code.slice(-1);
  if (k.length === 1) k = k.toLowerCase();
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return '';
  const shift = e.shiftKey && (k.length > 1 || /^[a-z]$/.test(k)) && k !== 'Space' ? 'shift+' : '';
  return `${e.metaKey || e.ctrlKey ? 'mod+' : ''}${e.altKey ? 'alt+' : ''}${shift}${k}`;
}

/** ¿Se escribe en un campo? Entonces no se disparan atajos de una sola tecla. */
export function isTyping(el: Element | null): boolean {
  const h = el as HTMLElement | null;
  return !!h && (h.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(h.tagName));
}
export const hasModifier = (b: string) => b.startsWith('mod+') || b.startsWith('alt+');

/** Conflictos: la misma tecla en el mismo ámbito, o una global que tapa la de un ámbito. */
export function conflicts(cfg: KeyConfig): { key: string; actions: string[] }[] {
  const out: { key: string; actions: string[] }[] = [];
  const all = ACTIONS.flatMap((a) => keysOf(cfg, a.id).map((k) => ({ k, a })));
  const seen = new Map<string, Set<string>>();
  for (const { k, a } of all) {
    const others = all.filter((x) => x.a.id !== a.id && (x.k === k || x.k.split(' ')[0] === k || k.split(' ')[0] === x.k) && (x.a.scope === a.scope || x.a.scope === 'global' || a.scope === 'global'));
    if (!others.length) continue;
    const key = [a.id, ...others.map((o) => o.a.id)].sort().join('|') + k;
    if (seen.has(key)) continue;
    seen.set(key, new Set());
    out.push({ key: k, actions: [a.id, ...new Set(others.map((o) => o.a.id))] });
  }
  return out.filter((c, i, arr) => arr.findIndex((x) => x.actions.slice().sort().join() === c.actions.slice().sort().join()) === i);
}

/**
 * Busca la acción de un ámbito para una pulsación, con secuencias (`g h`): `pending` es la
 * primera tecla de una secuencia en curso. Devuelve la acción o `{ wait }` si empieza una.
 */
export function resolve(cfg: KeyConfig, scopes: Scope[], b: string, pending: string | null): { action?: string; wait?: string } {
  if (!b) return {};
  const pool = ACTIONS.filter((a) => scopes.includes(a.scope));
  if (pending) {
    const hit = pool.find((a) => keysOf(cfg, a.id).includes(`${pending} ${b}`));
    if (hit) return { action: hit.id };
  }
  const direct = pool.find((a) => keysOf(cfg, a.id).includes(b));
  if (direct) return { action: direct.id };
  if (pool.some((a) => keysOf(cfg, a.id).some((k) => k.startsWith(b + ' ')))) return { wait: b };
  return {};
}

/** Acciones de un botón del mando en un ámbito. */
export function padActions(cfg: KeyConfig, scope: Scope, button: number): string[] {
  return ACTIONS.filter((a) => a.scope === scope && padOf(cfg, a.id).includes(button)).map((a) => a.id);
}

/** Nombre corto de un botón del mando estándar (para la pantalla y el indicador). */
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];

/** Cómo se ve una tecla en la interfaz. */
export function showKey(b: string, mac = true): string {
  return b.split(' ').map((part) => part.replace('mod+', mac ? '⌘' : 'Ctrl+').replace('shift+', mac ? '⇧' : 'Shift+').replace('alt+', mac ? '⌥' : 'Alt+')
    .replace(/^Space$|(?<=[⌘⇧⌥+])Space$/, '␣').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('Escape', 'Esc').replace(/(^|[⌘⇧⌥+])([a-z])$/, (_m, a: string, l: string) => a + l.toUpperCase())).join(' ');
}
