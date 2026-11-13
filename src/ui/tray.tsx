import { t } from '../i18n';
/**
 * Paneles minimizables como cuadritos (Mejora 1 · §4). Bandeja de paneles con
 * cuadritos de vidrio de 48 px: tocar restaura; pulsación larga → Restaurar · Cerrar;
 * si no caben, "＋n" abre una lista. Animación de resorte solo con transform/opacity.
 */
import type { ComponentChildren, JSX } from 'preact';
import { Minus } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { Sheet } from './kit';
import { readTextOr } from '../vault/util';

export interface TrayItem {
  id: string;
  label: string;
  icon: JSX.Element;
  /** dato vivo en miniatura (p. ej. 12:30) */
  live?: string;
  /** frase para VoiceOver (p. ej. "12:30 restantes") */
  liveLabel?: string;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Encoge el panel hacia la bandeja (o hacia abajo si aún no existe). */
export async function shrinkToTray(el: Element | null): Promise<void> {
  if (!el || reduced() || !('animate' in el)) return;
  const r = el.getBoundingClientRect();
  const t = document.querySelector('[data-tray]')?.getBoundingClientRect();
  const tx = t ? t.left + t.width / 2 - (r.left + r.width / 2) : 0;
  const ty = t ? t.top + t.height / 2 - (r.top + r.height / 2) : 120;
  const s = Math.max(0.05, 48 / Math.max(r.width, r.height));
  await (el as HTMLElement).animate(
    [{ transform: 'none', opacity: 1 }, { transform: `translate(${tx}px, ${ty}px) scale(${s})`, opacity: 0 }],
    { duration: 280, easing: 'cubic-bezier(.2,.9,.25,1.05)' },
  ).finished.catch(() => {});
}

/** Al restaurar: crece desde pequeño con resorte. */
export function growIn(el: Element | null) {
  if (!el || reduced() || !('animate' in el)) return;
  (el as HTMLElement).animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.9,.25,1.12)' });
}

export function MinButton(p: { label: string; onClick: (e: MouseEvent) => void }) {
  return (
    <button type="button" class="btn icon small ghost min-btn" aria-label={t('tray.minimizar_label', { label: p.label })} onClick={p.onClick}>
      <Minus size={18} />
    </button>
  );
}

export function Tray(p: { items: TrayItem[]; onRestore: (id: string) => void; onClose: (id: string) => void; max?: number; vertical?: boolean; floating?: boolean }) {
  const [menu, setMenu] = useState<TrayItem | null>(null);
  const [more, setMore] = useState(false);
  const press = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  if (!p.items.length) return null;
  const max = p.max ?? 5;
  const shown = p.items.length > max ? p.items.slice(0, max - 1) : p.items;
  const rest = p.items.slice(shown.length);
  const square = (it: TrayItem) => (
    <button
      type="button"
      class="tray-sq glass"
      aria-label={t('tray.label_minimizadop', { label: it.label, p: it.liveLabel ? `, ${it.liveLabel}` : '' })}
      data-tip={t('tray.label_minimizadop', { label: it.label, p: it.liveLabel ? `, ${it.liveLabel}` : '' })}
      onPointerDown={() => (press.current = { fired: false, t: setTimeout(() => { press.current!.fired = true; setMenu(it); }, 500) })}
      onPointerUp={() => press.current && clearTimeout(press.current.t)}
      onPointerLeave={() => press.current && clearTimeout(press.current.t)}
      onContextMenu={(e) => (e.preventDefault(), setMenu(it))}
      onClick={() => { if (press.current?.fired) return; p.onRestore(it.id); }}
    >
      {it.icon}
      {it.live && <span class="tray-live num">{it.live}</span>}
    </button>
  );
  return (
    <div class={`tray${p.vertical ? ' vertical' : ''}${p.floating ? ' floating' : ''}`} data-tray role="toolbar" aria-label={t('tray.paneles_minimizados')}>
      {shown.map(square)}
      {rest.length > 0 && <button type="button" class="tray-sq glass" aria-label={t('tray.n_paneles_minimizados_mas', { n: rest.length })} onClick={() => setMore(true)}><b>＋{rest.length}</b></button>}
      {menu && (
        <Sheet title={menu.label} onClose={() => setMenu(null)}>
          <div class="stack">
            <button type="button" class="btn primary" onClick={() => (p.onRestore(menu.id), setMenu(null))}>{t('notes.restaurar')}</button>
            <button type="button" class="btn" onClick={() => (p.onClose(menu.id), setMenu(null))}>{t('design.cerrar')}</button>
          </div>
        </Sheet>
      )}
      {more && (
        <Sheet title={t('tray.paneles_minimizados')} onClose={() => setMore(false)}>
          <div class="stack-s">
            {rest.map((it) => (
              <div class="row-i">
                <span class="k row">{it.icon} {it.label}{it.live ? <span class="num t2"> · {it.live}</span> : null}</span>
                <button type="button" class="btn small" onClick={() => (p.onRestore(it.id), setMore(false))}>{t('notes.restaurar')}</button>
                <button type="button" class="btn small" onClick={() => (p.onClose(it.id), setMore(false))}>{t('design.cerrar')}</button>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Estado de la bandeja del tablero Hoy, guardado como un espacio más (.app/spaces/_hoy.json). */
const HOY_STATE = '.app/spaces/_hoy.json';

export function useHoyTray() {
  const app = useApp();
  const [st, setSt] = useState<{ min: string[]; hidden: string[] }>({ min: [], hidden: [] });
  useEffect(() => {
    void readTextOr(app.vault, HOY_STATE, '').then((t) => {
      try {
        const j = JSON.parse(t) as { min?: unknown; hidden?: unknown };
        setSt({ min: Array.isArray(j.min) ? (j.min as string[]) : [], hidden: Array.isArray(j.hidden) ? (j.hidden as string[]) : [] });
      } catch {
        /* sin estado aún */
      }
    });
  }, []);
  const save = (n: { min: string[]; hidden: string[] }) => (setSt(n), void app.vault.write(HOY_STATE, JSON.stringify(n)));
  return {
    ...st,
    minimize: (id: string) => save({ ...st, min: [...st.min.filter((x) => x !== id), id] }),
    restore: (id: string) => save({ min: st.min.filter((x) => x !== id), hidden: st.hidden.filter((x) => x !== id) }),
    close: (id: string) => save({ min: st.min.filter((x) => x !== id), hidden: [...st.hidden.filter((x) => x !== id), id] }),
    reopenAll: () => save({ min: st.min, hidden: [] }),
  };
}

/** Envoltura para un panel minimizable del tablero Hoy. */
export function Minimizable(p: { id: string; label: string; tray: ReturnType<typeof useHoyTray>; children: (min: JSX.Element) => ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const wasMin = useRef(p.tray.min.includes(p.id));
  useEffect(() => {
    const isMin = p.tray.min.includes(p.id);
    if (wasMin.current && !isMin) growIn(ref.current);
    wasMin.current = isMin;
  }, [p.tray.min.join('|')]);
  if (p.tray.min.includes(p.id) || p.tray.hidden.includes(p.id)) return null;
  const btn = <MinButton label={p.label} onClick={async () => { await shrinkToTray(ref.current); p.tray.minimize(p.id); }} />;
  return <div ref={ref} class="minimizable">{p.children(btn)}</div>;
}
