import { Minus, Square, Zap } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { modalOpen } from '../ui/overlay';
import { t } from '../i18n';
import { useApp } from '../state';
import { getStatus, messages } from './history';
import { loadKeys, pickKey } from './keys';
import { Mascot, MASCOT_NAME, type MascotState } from './mascot';
import { PROVIDERS } from './providers';
import { stop } from './turn';
import { DictButton, VoiceMsg } from './dictbtn';
import { useDict } from './voice';
import { Quick } from './quick';
import { ProviderLogo } from './logos';
import { bar, loadUsage } from './usage';
import { useTick } from './tick';
import type { Ref } from 'preact';

/** Tira de uso «unida» bajo la pastilla: se ajusta al contenido (máx. 3 entradas y «+N»): logo del proveedor + barra + %.
 *  La clave activa en Bold y logo opaco; ≥ 80 % con barra más gruesa. Los logos son decorativos (el aria-label nombra al proveedor). */
function UsageStrip() {
  useTick();
  const { settings } = useApp();
  const keys = loadKeys().keys, now = Date.now();
  const act = pickKey(keys, now) ?? keys[0];
  if (!act) return null;
  const shown = [act, ...keys.filter((k) => k !== act)].slice(0, 3).sort((x, y) => keys.indexOf(x) - keys.indexOf(y));
  return (
    <div class="gx-ustrip glass" role="status" aria-label={t('dock.uso_modelo')}>
      {shown.map((k) => {
        const b = bar(loadUsage(), k.id, settings.chat.limits[k.provider], now, settings.chat.warnAt, k.provider);
        const hot = b.pct >= 0.8, pct = Math.round(b.pct * 100);
        return (
          <span key={k.id} class={`gx-u${k === act ? ' on' : ''}${hot ? ' hot' : ''}`} data-key={k.id} data-provider={k.provider} role="progressbar" aria-label={`${PROVIDERS[k.provider].name}: ${t('chat.uso')} ${b.label}${hot ? ` · ${t('dock.casi_limite')}` : ''}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <ProviderLogo provider={k.provider} size={10} /><span class="gx-bar"><i style={{ width: `${pct}%` }} /></span><span class="mono gx-pc">{b.label}</span>
          </span>
        );
      })}
      {keys.length > 3 && <span class="gx-u more" aria-label={`+${keys.length - 3}`}>+{keys.length - 3}</span>}
    </div>
  );
}

/** Pastilla del Asistente (una fila, 440×54): texto · ⚡ · Dictar · minimizar · GREX. Tocar el texto o a GREX abre el chat; «Dictar» lo abre ya dictando.
 *  Reposo, trabajando (estado + Detener) y error. «Acciones rápidas» sale con el cursor, el foco o ⚡. */
export function Dock(p: { ms: MascotState; avatarRef: Ref<HTMLButtonElement>; onOpen: () => void; onQuick: (text: string) => void; onMin: () => void }) {
  const dictating = useDict().state === 'listening';
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState(false), [edit, setEdit] = useState(false), [mode, setMode] = useState<'acc' | 'mod'>('acc'), [, bump] = useState(0);
  const st = getStatus(), msgs = messages(), last = msgs[msgs.length - 1];
  const err = !st.busy && last?.role === 'error';
  // táctil: ⚡ abre la pestaña; tocar fuera o Esc la cierran (editando se queda hasta «Listo»)
  useEffect(() => {
    if (!q && !edit && mode === 'acc') return;
    const away = (e: Event) => { if (modalOpen()) return; // una hoja encima (p. ej. «Añadir clave») no cierra la pestaña
      if (!root.current?.contains(e.target as Node)) { if (!(e.target as Element).closest?.('.popover')) { setQ(false); setEdit(false); setMode('acc'); } } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !modalOpen() && !document.querySelector('.popover')) { setQ(false); setEdit(false); setMode('acc'); e.stopPropagation(); root.current?.querySelector<HTMLElement>('.gx-avatar')?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [q, edit, mode]);

  let sub: string, dots = false;
  if (st.busy) {
    dots = !st.waitS;
    sub = st.waitS ? t('chat.p_espera', { s: st.waitS }) : st.tool ? t('dock.buscando') : last?.role === 'assistant' && last.text ? t('dock.escribiendo') : t('dock.pensando');
  } else if (dictating) sub = t('voz.escuchando');
  else if (err) sub = t('dock.error_sub');
  else sub = t('dock.reposo_sub');

  return (
    <div ref={root} class={`gx-dock${st.busy ? ' work' : ''}${q || edit || mode === 'mod' ? ' q' : ''}`} data-state={st.busy ? 'busy' : err ? 'error' : 'idle'}>
      <Quick editing={edit} onEdit={setEdit} mode={mode} onMode={setMode} onChange={() => bump((n) => n + 1)} onPick={(text) => { setQ(false); setEdit(false); p.onQuick(text); }} />
      <div class="gx-pw">
      <div class="gx-pill glass strong">
        <div class="gx-txt" role="status" onClick={p.onOpen}>
          <div class="gx-ttl">{MASCOT_NAME}</div>
          <div class="gx-sub"><span class={`gx-st${dots ? ' dots' : ''}`} data-user-content>{sub}</span></div>
        </div>
        <button type="button" class="gx-ib" aria-label={t('dock.rapidas')} aria-expanded={q} aria-controls="gx-quick" onClick={() => setQ(!q)}><Zap size={18} aria-hidden="true" /></button>
        {st.busy
          ? <button type="button" class="gx-act stop" onClick={stop}><Square size={13} fill="currentColor" aria-hidden="true" />{t('chat.p_detener')}</button>
          : <DictButton variant="pill" onStart={p.onOpen} />}
        <button type="button" class="gx-ib" aria-label={t('dock.minimizar')} onClick={p.onMin}><Minus size={20} aria-hidden="true" /></button>
        <button ref={p.avatarRef} type="button" class="gx-avatar" aria-label={t('chat.p_abrir')} aria-haspopup="dialog" onClick={p.onOpen}>
          <Mascot size={34} state={p.ms} />
        </button>
      </div>
      <UsageStrip />
      </div>
      <VoiceMsg />
    </div>
  );
}

/** Minimizada: solo GREX en un cuadrito de vidrio, abajo a la derecha; un toque abre la pastilla. */
export function DockMini(p: { ms: MascotState; btnRef: Ref<HTMLButtonElement>; onRestore: () => void }) {
  return (
    <button ref={p.btnRef} type="button" class={`gx-mini glass strong${getStatus().busy ? ' work' : ''}`} aria-label={t('dock.restaurar')} onClick={p.onRestore}>
      <Mascot size={44} state={p.ms} />
    </button>
  );
}
