import { Mic } from 'lucide-preact';
import { useRef } from 'preact/hooks';
import { t } from '../i18n';
import { dictate, useDict } from './voice';

const HOLD_MS = 350;

/** Botón «Dictar». Toque = empezar/detener; mantener ≥ 350 ms = hablar mientras se mantiene y detener al soltar.
 *  `start()` va dentro del gesto (pointerdown/clic). `pill` = el de la barra; `icon` = el del campo del panel. */
export function DictButton(p: { variant: 'pill' | 'icon'; onStart?: () => void }) {
  const dict = useDict(), on = dict.state === 'listening';
  const down = useRef<{ at: number; was: boolean } | null>(null);
  const begin = () => { dictate.start(); p.onStart?.(); }; // abre el panel aunque no haya soporte (se enfoca el campo)
  const label = on ? t('voz.escuchando_detener') : t('voz.dictar');
  const ev = {
    onPointerDown: (e: PointerEvent) => {
      if (e.button > 0 || !e.isPrimary) return;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      down.current = { at: Date.now(), was: on };
      if (!on) begin();
    },
    onPointerUp: () => {
      const s = down.current; down.current = null;
      if (!s) return;
      if (s.was || Date.now() - s.at >= HOLD_MS) dictate.stop();
    },
    onPointerCancel: () => { if (down.current) { down.current = null; dictate.stop(); } },
    onClick: (e: MouseEvent) => { if (e.detail === 0) (on ? dictate.stop() : begin()); }, // teclado
    onContextMenu: (e: Event) => e.preventDefault(),
  };
  return p.variant === 'pill'
    ? <button type="button" class={`gx-act vz${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} {...ev}><Mic size={17} aria-hidden="true" />{label}</button>
    : <button type="button" class={`btn icon vz${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} {...ev}><Mic size={18} aria-hidden="true" /></button>;
}

/** Mensaje del dictado (permiso, sin soporte…) bajo el botón; región viva. */
export function VoiceMsg() {
  const { msg } = useDict();
  return <div class="gx-voz-msg" role="status" aria-live="polite">{msg ? t(msg) : ''}</div>;
}
