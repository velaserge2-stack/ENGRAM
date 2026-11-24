import { Minus, SlidersHorizontal, Square, Zap, PenLine } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { go, useApp } from '../state';
import { getStatus, messages } from './history';
import { loadKeys } from './keys';
import { Mascot, MASCOT_NAME, type MascotState } from './mascot';
import { PROVIDERS } from './providers';
import { stop } from './turn';
import { bar, loadUsage } from './usage';
import type { Ref } from 'preact';

/** Atajos de la pestaña «Acciones rápidas»: solo rellenan el campo, nunca envían. */
const QUICK = () => [
  { k: 'tarjetas', label: t('dock.q_tarjetas'), text: t('dock.q_tarjetas_t') },
  { k: 'resumir', label: t('dock.q_resumir'), text: t('dock.q_resumir_t') },
  { k: 'examen', label: t('dock.q_examen'), text: t('dock.q_examen_t') },
];

/** Chips de uso por clave: barra + %; desde el 80 % más gruesa y en negrita («casi al límite»). */
function Usage() {
  const { settings } = useApp();
  const keys = loadKeys().keys, u = loadUsage(), now = Date.now();
  if (!keys.length) return null;
  const dup = (p: string) => keys.filter((k) => k.provider === p).length > 1;
  return (
    <div class="gx-usage glass" role="group" aria-label={t('chat.uso')}>
      {keys.map((k) => {
        const b = bar(u, k.id, settings.chat.limits[k.provider], now, settings.chat.warnAt);
        const hot = b.pct >= 0.8, name = PROVIDERS[k.provider].name + (dup(k.provider) ? ` · ${k.alias}` : '');
        return (
          <span key={k.id} class={hot ? 'gx-u hot' : 'gx-u'}>
            <span data-user-content>{name}</span>
            <span class="gx-bar" role="progressbar" aria-label={`${name}: ${t('chat.uso')}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.pct * 100)}><i style={{ width: `${Math.round(b.pct * 100)}%` }} /></span>
            {b.label}{hot && <> · {t('dock.casi_limite')}</>}
          </span>
        );
      })}
    </div>
  );
}

/** Barra del Asistente: fija abajo al centro (una sola posición, `--dock-bottom`). Reposo, trabajando (estado + Detener) y error. */
export function Dock(p: { open: boolean; ms: MascotState; avatarRef: Ref<HTMLButtonElement>; onToggle: () => void; onMin: () => void; onQuick: (text: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(false);
  const st = getStatus(), msgs = messages(), last = msgs[msgs.length - 1];
  const err = !st.busy && last?.role === 'error';
  // alto real → --dock-h (el panel se coloca encima); una sola escritura por cambio
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !('ResizeObserver' in window)) return;
    const set = () => document.documentElement.style.setProperty('--dock-h', `${Math.round(el.offsetHeight)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--dock-h'); };
  }, []);
  useEffect(() => {
    if (!tab) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setTab(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setTab(false); e.stopPropagation(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [tab]);

  let ttl: string, sub: string, dots = false;
  if (st.busy) {
    dots = !st.waitS;
    ttl = st.waitS ? t('chat.p_espera', { s: st.waitS }) : st.tool ? t('dock.buscando') : last?.role === 'assistant' && last.text ? t('dock.escribiendo') : t('dock.pensando');
    sub = st.tool ?? t('dock.sub_trabajando');
  } else if (err) { ttl = t('dock.error'); sub = t('dock.error_sub'); }
  else { ttl = t('dock.reposo', { nombre: MASCOT_NAME }); sub = t('dock.reposo_sub'); }

  return (
    <div ref={root} class={`gx-dock${st.busy ? ' work' : ''}`} data-state={st.busy ? 'busy' : err ? 'error' : 'idle'}>
      <button type="button" class="gx-tab glass" aria-expanded={tab} aria-controls="gx-quick" onClick={() => setTab(!tab)}><Zap size={15} aria-hidden="true" />{t('dock.rapidas')}</button>
      {tab && (
        <div id="gx-quick" class="gx-quick glass strong" role="group" aria-label={t('dock.rapidas')}>
          {QUICK().map((q) => <button type="button" class="gx-chip" key={q.k} onClick={() => { setTab(false); p.onQuick(q.text); }}>{q.label}</button>)}
        </div>
      )}
      <div class="gx-pill glass strong">
        <button type="button" class="gx-ib" aria-label={t('dock.ajustes')} onClick={() => go('ajustes')}><SlidersHorizontal size={22} aria-hidden="true" /></button>
        <div class="gx-txt" role="status" onClick={p.onToggle}>
          <div class={`gx-ttl${dots ? ' dots' : ''}`}>{ttl}</div>
          <div class="gx-sub" data-user-content>{sub}</div>
        </div>
        {st.busy
          ? <button type="button" class="gx-act stop" onClick={stop}><Square size={14} fill="currentColor" aria-hidden="true" />{t('chat.p_detener')}</button>
          : <button type="button" class="gx-act" onClick={p.onToggle}><PenLine size={17} aria-hidden="true" />{t('dock.escribir')}</button>}
        <button type="button" class="gx-ib" aria-label={t('dock.minimizar')} onClick={p.onMin}><Minus size={22} aria-hidden="true" /></button>
        <button ref={p.avatarRef} type="button" class="gx-avatar" aria-label={p.open ? t('chat.p_cerrar') : t('chat.p_abrir')} aria-haspopup="dialog" aria-expanded={p.open} onClick={p.onToggle}>
          <Mascot size={46} state={p.ms} />
        </button>
      </div>
      <Usage />
    </div>
  );
}

/** Minimizada: solo GREX, abajo a la derecha; un toque restaura la barra. */
export function DockMini(p: { ms: MascotState; btnRef: Ref<HTMLButtonElement>; onRestore: () => void }) {
  return (
    <button ref={p.btnRef} type="button" class={`gx-mini glass strong${getStatus().busy ? ' work' : ''}`} aria-label={t('dock.restaurar')} onClick={p.onRestore}>
      <Mascot size={44} state={p.ms} />
    </button>
  );
}
