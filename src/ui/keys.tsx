import { t } from '../i18n';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ACTIONS, bindingOf, defaultConfig, hasModifier, isTyping, KEYMAP_PATH, type KeyConfig, keysOf, PAD_NAMES, padActions, padOf, parseConfig, resolve, type Scope, showKey } from '../lib/keys';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';
import { Sheet } from './kit';
import { modalOpen } from './overlay';

/** Configuración vigente de atajos (se carga al abrir la app; se guarda en .app/atajos.json). */
const listeners = new Set<() => void>();
export const keymap = {
  cfg: defaultConfig(),
  set(c: KeyConfig) { keymap.cfg = c; listeners.forEach((f) => f()); },
  async load(vault: VaultAdapter) { keymap.set(parseConfig(await readTextOr(vault, KEYMAP_PATH, '{}'))); },
  async save(vault: VaultAdapter, c: KeyConfig) { keymap.set(c); await vault.write(KEYMAP_PATH, JSON.stringify(c, null, 1)); },
  subscribe(f: () => void) { listeners.add(f); return () => listeners.delete(f); },
};
export function useKeymap(): KeyConfig {
  const [, set] = useState(0);
  useEffect(() => keymap.subscribe(() => set((n) => n + 1)), []);
  return keymap.cfg;
}

export const actionLabel = (id: string) => t(`keys.${id.replace('.', '_')}`);
export type Via = { kind: 'key' | 'pad'; label: string; binding?: string };

/** Mando: botones recién pulsados (flanco de subida) de todos los mandos conectados. */
function usePad(onButton: (i: number, name: string) => void, enabled: boolean) {
  const cb = useRef(onButton);
  cb.current = onButton;
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('getGamepads' in navigator)) return;
    let raf = 0;
    const prev = new Map<number, boolean[]>();
    const loop = () => {
      for (const g of navigator.getGamepads()) {
        if (!g) continue;
        const was = prev.get(g.index) ?? [];
        const now = g.buttons.map((b) => b.pressed || b.value > 0.5);
        now.forEach((p, i) => p && !was[i] && cb.current(i, PAD_NAMES[i] ?? `#${i}`));
        prev.set(g.index, now);
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
    addEventListener('gamepadconnected', start);
    if ([...navigator.getGamepads()].some(Boolean)) start();
    return () => (removeEventListener('gamepadconnected', start), cancelAnimationFrame(raf));
  }, [enabled]);
}

/**
 * Atajos de un ámbito (repaso, simulacro, tinta): las teclas sin modificador NO se disparan
 * mientras se escribe en un campo, ni con un modal abierto. También escucha el mando.
 */
export function useKeyScope(scope: Scope, onAction: (id: string, via: Via) => void, enabled = true) {
  const cb = useRef(onAction);
  cb.current = onAction;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen()) return;
      const b = bindingOf(e);
      if (!b || (isTyping(e.target as Element) && !hasModifier(b))) return;
      const r = resolve(keymap.cfg, [scope], b, null);
      if (r.action) (e.preventDefault(), cb.current(r.action, { kind: 'key', label: showKey(b), binding: b }));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [enabled, scope]);
  usePad((i, name) => { if (modalOpen()) return; for (const a of padActions(keymap.cfg, scope, i)) cb.current(a, { kind: 'pad', label: name }); }, enabled);
}

/** Atajos globales con secuencias («G» y luego «H»): se montan una vez en App. */
export function GlobalKeys(p: { run: (id: string) => void }) {
  const pending = useRef<{ k: string; at: number } | null>(null);
  const cb = useRef(p.run);
  cb.current = p.run;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen()) return;
      const b = bindingOf(e);
      if (!b || (isTyping(e.target as Element) && !hasModifier(b))) return;
      const pend = pending.current && Date.now() - pending.current.at < 1500 ? pending.current.k : null;
      pending.current = null;
      const r = resolve(keymap.cfg, ['global'], b, pend);
      if (r.action) (e.preventDefault(), cb.current(r.action));
      else if (r.wait) pending.current = { k: r.wait, at: Date.now() };
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return null;
}

let audio: AudioContext | null = null;
/** Indicador discreto del último botón o tecla, con sonido opcional (no hay vibración web en iPad). */
export function KeyFeedback(p: { last: { via: Via; action: string; at: number } | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!p.last) return;
    setShow(true);
    if (keymap.cfg.sound) {
      try {
        audio ??= new AudioContext();
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.06, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.08);
        o.connect(g).connect(audio.destination);
        o.start();
        o.stop(audio.currentTime + 0.09);
      } catch { /* sin audio */ }
    }
    const tm = setTimeout(() => setShow(false), 1400);
    return () => clearTimeout(tm);
  }, [p.last?.at]);
  if (!p.last || !show) return null;
  return <div class="key-feedback glass strong" role="status" aria-live="polite">{p.last.via.kind === 'pad' ? '🎮' : '⌨'} {p.last.via.label} → {actionLabel(p.last.action)}</div>;
}

const SCOPES: Scope[] = ['global', 'study', 'sim', 'ink', 'editor'];
/** Hoja de atajos («?»). */
export function ShortcutSheet(p: { onClose: () => void }) {
  const cfg = useKeymap();
  return (
    <Sheet title={t('keys.hoja_de_atajos')} onClose={p.onClose} wide>
      <div class="shortcut-grid">
        {SCOPES.map((s) => (
          <section class="stack-s">
            <h3 class="group-h" style={{ padding: '0' }}>{t(`keys.scope_${s}`)}</h3>
            {ACTIONS.filter((a) => a.scope === s).map((a) => (
              <div class="kv"><span class="k">{actionLabel(a.id)}</span><span class="v">{keysOf(cfg, a.id).map((k) => <kbd class="kbd">{showKey(k)}</kbd>)}{padOf(cfg, a.id).map((i) => <kbd class="kbd">🎮 {PAD_NAMES[i] ?? i}</kbd>)}</span></div>
            ))}
          </section>
        ))}
      </div>
      <p class="foot" style={{ marginTop: '10px' }}>{t('keys.nota_hoja')}</p>
    </Sheet>
  );
}
