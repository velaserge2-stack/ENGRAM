import { Minus, SlidersHorizontal, Square, PenLine } from 'lucide-preact';
import { t } from '../i18n';
import { go, useApp } from '../state';
import { getStatus, messages } from './history';
import { loadKeys, pickKey } from './keys';
import { Mascot, MASCOT_NAME, type MascotState } from './mascot';
import { PROVIDERS } from './providers';
import { stop } from './turn';
import { DictButton, VoiceMsg } from './dictbtn';
import { useDict } from './voice';
import { Quick } from './quick';
import { bar, loadUsage } from './usage';
import type { Ref } from 'preact';

/** Chip diminuto de uso de la clave en curso (barra + %); desde el 80 % en negrita, «casi al límite» solo como etiqueta. */
function Usage() {
  const { settings } = useApp();
  const keys = loadKeys().keys, now = Date.now();
  const k = pickKey(keys, now) ?? keys[0];
  if (!k) return null;
  const b = bar(loadUsage(), k.id, settings.chat.limits[k.provider], now, settings.chat.warnAt);
  const hot = b.pct >= 0.8, pct = Math.round(b.pct * 100);
  const label = `${PROVIDERS[k.provider].name}${keys.filter((x) => x.provider === k.provider).length > 1 ? ` · ${k.alias}` : ''}: ${t('chat.uso')} ${b.label}${hot ? ` · ${t('dock.casi_limite')}` : ''}`;
  return (
    <span class={hot ? 'gx-u hot' : 'gx-u'} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span class="gx-bar"><i style={{ width: `${pct}%` }} /></span>{b.label}
    </span>
  );
}

/** Pastilla del Asistente (una sola fila): ajustes · GREX · nombre + subtítulo · Dictar · Escribir · minimizar. Reposo, trabajando (estado + Detener) y error.
 *  Cualquier acción de escribir o dictar abre el chat (la pastilla deja de existir mientras el chat está abierto). */
export function Dock(p: { ms: MascotState; avatarRef: Ref<HTMLButtonElement>; onOpen: () => void; onQuick: (text: string) => void; onMin: () => void }) {
  const dictating = useDict().state === 'listening';
  const st = getStatus(), msgs = messages(), last = msgs[msgs.length - 1];
  const err = !st.busy && last?.role === 'error';

  let sub: string, dots = false;
  if (st.busy) {
    dots = !st.waitS;
    sub = st.waitS ? t('chat.p_espera', { s: st.waitS }) : st.tool ? t('dock.buscando') : last?.role === 'assistant' && last.text ? t('dock.escribiendo') : t('dock.pensando');
  } else if (dictating) sub = t('voz.escuchando');
  else if (err) sub = t('dock.error_sub');
  else sub = t('dock.reposo_sub');

  return (
    <div class={`gx-dock${st.busy ? ' work' : ''}`} data-state={st.busy ? 'busy' : err ? 'error' : 'idle'}>
      <Quick onPick={p.onQuick} />
      <div class="gx-pill glass strong">
        <button type="button" class="gx-ib" aria-label={t('dock.ajustes')} onClick={() => go('ajustes')}><SlidersHorizontal size={20} aria-hidden="true" /></button>
        <button ref={p.avatarRef} type="button" class="gx-avatar" aria-label={t('chat.p_abrir')} aria-haspopup="dialog" onClick={p.onOpen}>
          <Mascot size={36} state={p.ms} />
        </button>
        <div class="gx-txt" role="status" onClick={p.onOpen}>
          <div class="gx-ttl">{MASCOT_NAME}<Usage /></div>
          <div class={`gx-sub${dots ? ' dots' : ''}`} data-user-content>{sub}</div>
        </div>
        {st.busy
          ? <button type="button" class="gx-act stop" onClick={stop}><Square size={13} fill="currentColor" aria-hidden="true" />{t('chat.p_detener')}</button>
          : <><DictButton variant="pill" onStart={p.onOpen} /><button type="button" class="gx-act" onClick={p.onOpen}><PenLine size={16} aria-hidden="true" />{t('dock.escribir')}</button></>}
        <button type="button" class="gx-ib" aria-label={t('dock.minimizar')} onClick={p.onMin}><Minus size={20} aria-hidden="true" /></button>
      </div>
      <VoiceMsg />
    </div>
  );
}

/** Minimizada: solo GREX en un cuadrito de vidrio, abajo a la derecha; un toque abre la pastilla. */
export function DockMini(p: { ms: MascotState; btnRef: Ref<HTMLButtonElement>; onRestore: () => void }) {
  return (
    <button ref={p.btnRef} type="button" class={`gx-mini glass strong${getStatus().busy ? ' work' : ''}`} aria-label={t('dock.restaurar')} onClick={p.onRestore}>
      <Mascot size={40} state={p.ms} />
    </button>
  );
}
