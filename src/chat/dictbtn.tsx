import { Mic } from 'lucide-preact';
import { t } from '../i18n';
import { isDemo } from '../demo/state';
import { dictate, useDict } from './voice';

/** Botón «Dictar»: toque = empezar, segundo toque = detener. El reconocimiento arranca en `pointerup`/`click` (activación de usuario real;
 *  `pointerdown` no la da en Safari táctil). `pill` = el de la barra; `icon` = el del campo del panel. */
export function DictButton(p: { variant: 'pill' | 'icon'; onStart?: () => void }) {
  const dict = useDict(), on = dict.state === 'listening';
  // pill: abre el chat en el mismo gesto (la pastilla desaparece); abre aunque no haya API (modo sistema: se enfoca el campo)
  const pill = p.variant === 'pill';
  if (isDemo()) return null; // demo: sin micrófono
  const label = on ? t('voz.escuchando_detener') : t('voz.dictar');
  const toggle = () => { if (on) dictate.stop(); else dictate.start(); if (pill) p.onStart?.(); else if (!on) p.onStart?.(); };
  const ev = {
    onPointerUp: (e: PointerEvent) => { if (e.button > 0 || !e.isPrimary) return; e.preventDefault(); toggle(); },
    onClick: (e: MouseEvent) => { if (e.detail === 0) toggle(); }, // teclado
    onContextMenu: (e: Event) => e.preventDefault(),
  };
  return pill
    ? <button type="button" class={`gx-act vz${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} {...ev}><Mic size={16} aria-hidden="true" />{t('voz.dictar')}</button>
    : <button type="button" class={`btn icon vz${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} {...ev}><Mic size={18} aria-hidden="true" /></button>;
}

/** Mensaje del dictado (permiso, sin soporte…) bajo el botón; región viva. */
export function VoiceMsg() {
  const { msg, help } = useDict();
  return (
    <div class="gx-voz-msg" role="status" aria-live="polite">
      {msg && <div>{t(msg)}</div>}
      {help && <div class="gx-voz-help"><Mic size={14} aria-hidden="true" /> {t(`voz3.ayuda_${help === 'other' ? 'otro' : help}`)}</div>}
      {help && help !== 'other' && <div>{t(`voz3.activar_${help}`)}</div>}
    </div>
  );
}
