import { t } from '../i18n';
import { techLine } from './errors';
import { CircleAlert, Maximize2, Minimize2, SendHorizontal, Square, SquarePen, X } from 'lucide-preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { renderMarkdown } from '../md/render';
import { dayKey } from '../lib/days';
import { go, useApp } from '../state';
import { Portal, useLayer } from '../ui/overlay';
import { getStatus, type Msg, messages, clear, subscribe } from './history';
import { loadKeys, pickKey } from './keys';
import { citeHref, citeLabel, PDF_CITE, resolveNote, resolvePdf } from './cites';
import { Mascot, useMascotState } from './mascot';
import { forgetProposals } from './proposal';
import { Preview } from './preview';
import type { Source } from './tools';
import { send, stop } from './turn';
import { setModels } from './providers';
import { bar, loadUsage } from './usage';

const ERR: Record<string, string> = { nokey: 'nokey', auth: 'auth', quota: 'quota', rate: 'rate', model: 'model', timeout: 'timeout', network: 'network', server: 'server', busy: 'busy' };
const NEEDS_SETTINGS = new Set(['nokey', 'auth', 'quota', 'model']);

/** Cita tocable (≥ 44 px, vía CSS) si la fuente la devolvió una herramienta en este turno; si no, texto inerte con aviso. */
function citeEl(label: string, src: Source | null): HTMLElement {
  if (src) {
    const a = document.createElement('a');
    a.className = 'chat-cite'; a.href = citeHref(src); a.textContent = citeLabel(src);
    return a;
  }
  const sp = document.createElement('span');
  sp.className = 'chat-cite off'; sp.setAttribute('aria-disabled', 'true'); sp.textContent = label;
  const sr = document.createElement('span');
  sr.className = 'sr-only'; sr.textContent = ` (${t('chat.p_cita_no')})`;
  sp.append(sr);
  return sp;
}

/** Las respuestas ya vienen saneadas (DOMPurify); aquí además: sin imágenes ni medios, sin href externo (texto + dominio), y citas validadas contra las fuentes del turno. */
export function harden(el: HTMLElement, sources: readonly Source[]) {
  el.querySelectorAll('img, audio, video, [data-media]').forEach((n) => n.replaceWith(document.createTextNode(n.getAttribute('alt') ?? '')));
  el.querySelectorAll('a').forEach((a) => {
    const wl = a.getAttribute('data-wl');
    if (a.classList.contains('wl') || wl !== null) a.replaceWith(citeEl(wl ?? a.textContent ?? '', resolveNote(wl ?? a.textContent ?? '', sources)));
    else {
      // enlaces del modelo: nunca clicables (podrían sacar datos en la URL); se muestra el texto y el dominio
      let host = '';
      try { host = new URL(a.getAttribute('href') ?? '').hostname; } catch { /* relativo o inválido */ }
      a.replaceWith(...Array.from(a.childNodes), ...(host ? [document.createTextNode(` (${host})`)] : []));
    }
  });
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) if (new RegExp(PDF_CITE.source, 'i').test(n.nodeValue ?? '')) hits.push(n as Text);
  for (const n of hits) {
    const frag = document.createDocumentFragment(), text = n.nodeValue ?? '';
    let at = 0;
    for (const m of text.matchAll(PDF_CITE)) {
      frag.append(text.slice(at, m.index), citeEl(m[0], resolvePdf(m[1]!, Number(m[2]), sources)));
      at = m.index! + m[0].length;
    }
    frag.append(text.slice(at));
    n.replaceWith(frag);
  }
}

function Answer(p: { text: string; sources?: Source[]; onCite: () => void }) {
  // se endurece en un <template> inerte: así ninguna <img> remota llega a cargarse (ni una petición) antes de quitarla
  const html = useMemo(() => {
    const tpl = document.createElement('template');
    tpl.innerHTML = renderMarkdown(p.text);
    harden(tpl.content as unknown as HTMLElement, p.sources ?? []);
    return tpl.innerHTML;
  }, [p.text, p.sources?.length]);
  return <div class="chat-msg assistant md" data-user-content dangerouslySetInnerHTML={{ __html: html }} onClick={(e) => { if ((e.target as HTMLElement).closest('a.chat-cite')) p.onCite(); }} />;
}

function Settings(p: { onClick: () => void }) {
  return <button type="button" class="btn small" onClick={p.onClick}>{t('chat.p_ajustes')}</button>;
}

function Bubble(p: { m: Msg; onSettings: () => void; onCite: () => void }) {
  const { m } = p;
  if (m.role === 'user') return <article class="chat-msg user" data-user-content><span class="sr-only">{t('chat.p_tu')}: </span>{m.text}</article>;
  if (m.role === 'proposal') return <Preview m={m} />;
  if (m.role === 'assistant') return <Answer text={m.text} sources={m.sources} onCite={p.onCite} />;
  if (m.role === 'notice') {
    return <p class="chat-note">{m.code === 'rotated' ? t('chat.p_rotada', { alias: m.alias ?? '' }) : t('chat.p_detenida')}</p>;
  }
  const k = ERR[m.code ?? ''] ?? 'other';
  return (
    <div class="chat-err">
      <CircleAlert size={18} aria-hidden="true" />
      <b>{k === 'model' ? t('chat.p_err_model', { modelo: m.detail?.model ?? '' }) : t(`chat.p_err_${k}`)}</b>
      {NEEDS_SETTINGS.has(m.code ?? '') && <Settings onClick={p.onSettings} />}
      {m.detail && techLine(m.detail) && <details class="chat-tech"><summary>{t('chat.detalle')}</summary><code>{techLine(m.detail)}</code></details>}
    </div>
  );
}

/** Barra de uso: solo al acercarse al límite; con todas las claves agotadas o inválidas, además, el botón a Ajustes. */
function Meter(p: { alias?: string; onSettings: () => void }) {
  const { settings } = useApp();
  const now = Date.now(), keys = loadKeys().keys;
  const used = keys.find((k) => k.alias === p.alias) ?? pickKey(keys, now) ?? keys[0];
  const dead = keys.length > 0 && !pickKey(keys, now);
  const b = used ? bar(loadUsage(), used.id, settings.chat.limits[used.provider], now, settings.chat.warnAt) : null;
  if (!dead && !b?.show) return null;
  const pct = dead ? 100 : Math.round((b?.pct ?? 0) * 100);
  return (
    <div class="chat-usage">
      <span>{dead ? t('chat.p_agotadas') : t('chat.p_uso', { pct: b!.label })}</span>
      <div class="chat-bar" role="progressbar" aria-label={t('chat.uso')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
      {dead && <Settings onClick={p.onSettings} />}
    </div>
  );
}

export default function Conversation(p: { size: 'compact' | 'large'; phone: boolean; onClose: () => void; onSize: () => void }) {
  const app = useApp();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribe(bump as () => void), []);
  const msgs = messages(), st = getStatus();
  const root = useRef<HTMLElement>(null), log = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  // teléfono = hoja a pantalla completa (modal, foco atrapado); iPad y web = panel que no bloquea la app
  useLayer(p.onClose, { modal: p.phone, el: () => root.current });
  useLayoutEffect(() => { if (!p.phone) input.current?.focus(); }, []);
  const [foc, setFoc] = useState(false), [has, setHas] = useState(false);
  const ms = useMascotState(foc || has);
  const stick = useRef(true);
  useLayoutEffect(() => { const l = log.current; if (l && stick.current) l.scrollTop = l.scrollHeight; });
  const toSettings = () => { p.onClose(); go('ajustes'); };

  const submit = () => {
    const el = input.current;
    if (!el || !el.value.trim() || st.busy) return;
    const q = el.value;
    el.value = ''; el.style.height = ''; setHas(false);
    stick.current = true;
    setModels(app.settings.chat.models);
    void send(q, { vault: app.vault, col: app.col, today: dayKey(Date.now(), app.settings.timeZone, app.settings.dayStartHour) });
  };
  const grow = (e: Event) => { const el = e.currentTarget as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; };
  const last = msgs[msgs.length - 1];
  const waiting = st.busy && (!!st.tool || (last?.role === 'assistant' && !last.text));

  return (
    <Portal>
      <section ref={root} class={`chat-panel glass strong ${p.size}`} role="dialog" aria-modal={p.phone ? 'true' : undefined} aria-label={t('chat.p_titulo')} tabIndex={-1}>
        <header class="chat-h">
          <Mascot size={24} state={ms} />
          <div class="chat-title">
            <h2>{t('chat.p_titulo')}</h2>
            {st.alias && <span class="foot ellipsis" data-user-content>{t('chat.p_clave_usada', { alias: st.alias })}</span>}
          </div>
          <button type="button" class="btn icon ghost" aria-label={t('chat.p_nueva')} onClick={() => { clear(); forgetProposals(); input.current?.focus(); }}><SquarePen size={18} aria-hidden="true" /></button>
          {!p.phone && (
            <button type="button" class="btn icon ghost" aria-label={p.size === 'large' ? t('chat.p_compacto') : t('chat.p_grande')} aria-pressed={p.size === 'large'} onClick={p.onSize}>
              {p.size === 'large' ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
            </button>
          )}
          <button type="button" class="btn icon ghost" aria-label={t('chat.p_cerrar')} onClick={p.onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <Meter alias={st.alias} onSettings={toSettings} />
        <div ref={log} class="chat-log" role="log" aria-live="polite" aria-relevant="additions text" aria-busy={st.busy} aria-label={t('chat.p_conv')} tabIndex={0}
          onScroll={(e) => { const l = e.currentTarget as HTMLElement; stick.current = l.scrollHeight - l.scrollTop - l.clientHeight < 40; }}>
          {!msgs.length && <div class="chat-empty"><p><b>{t('chat.p_vacio')}</b></p><p class="foot">{t('chat.p_vacio_sub')}</p></div>}
          {msgs.map((m) => (m.role === 'assistant' && !m.text ? null : <Bubble key={m.id} m={m} onSettings={toSettings} onCite={() => { if (p.phone) p.onClose(); }} />))}
          {waiting && <p class="chat-note" role="status">{st.waitS ? t('chat.p_espera', { s: st.waitS }) : st.tool ? t('chat.p_buscando') : t('chat.p_pensando')}</p>}
        </div>
        <form class="chat-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea ref={input} class="input" rows={1} aria-label={t('chat.p_escribe')} placeholder={t('chat.p_escribe')} onInput={(e) => { grow(e); setHas(!!(e.currentTarget as HTMLTextAreaElement).value.trim()); }} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !p.phone) { e.preventDefault(); submit(); } }} />
          {/* claves distintas: si no, el mismo <button> pasaría de «Detener» a «Enviar» en pleno clic y lo enviaría */}
          {st.busy
            ? <button key="stop" type="button" class="btn icon" aria-label={t('chat.p_detener')} onClick={stop}><Square size={18} aria-hidden="true" /></button>
            : <button key="send" type="submit" class="btn icon primary" aria-label={t('chat.p_enviar')}><SendHorizontal size={18} aria-hidden="true" /></button>}
        </form>
      </section>
    </Portal>
  );
}
