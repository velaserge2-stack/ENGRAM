// Vista previa de una propuesta de escritura del Asistente: Aceptar escribe (por SafeVault), Editar revalida, Cancelar no escribe.
// Todo se pinta como TEXTO (Preact escapa); nada de innerHTML. El deshacer queda visible hasta «Nueva conversación».
import { Check, Pencil, Undo2, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { useApp } from '../state';
import { redact } from './errors';
import { type Msg, patch } from './history';
import { applyProposal, type EventFields, isBad, revalidate, undoProposal } from './proposal';

const TITLE = { tarjetas: 'chat.pv_t_tarjetas', examen: 'chat.pv_t_examen', evento: 'chat.pv_t_evento' } as const;
const FIELDS = ['titulo', 'fecha', 'inicio', 'fin', 'materia', 'nota'] as const;
const TYPE: Record<string, 'date' | 'time'> = { fecha: 'date', inicio: 'time', fin: 'time' };

/** Código de aviso (i18n `chat.pv_werr_*`) de un fallo al guardar; los DOMException de almacenamiento tienen mensaje propio. */
const werr = (e: unknown): string => {
  const n = e instanceof Error ? (e.name === 'Error' ? e.message : e.name) : '';
  return ({ open: 'open', exists: 'exists', gone: 'gone', QuotaExceededError: 'quota', NotAllowedError: 'denied', SecurityError: 'denied', NotFoundError: 'notfound' } as Record<string, string>)[n] ?? 'other';
};
/** «Nombre: mensaje» corto y sin claves, para diagnosticar fallos no clasificados. */
const tech = (e: unknown): string => redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(/\s+/g, ' ').slice(0, 160);

export function Preview({ m }: { m: Msg }) {
  const app = useApp();
  const p = m.proposal!;
  const st = m.pstate ?? 'pending';
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const [ev, setEv] = useState<EventFields | null>(null);
  const [err, setErr] = useState('');
  const lock = useRef(false);
  const root = useRef<HTMLElement>(null), first = useRef<HTMLElement>(null), editBtn = useRef<HTMLButtonElement>(null);
  const seen = useRef(st);
  // al cambiar de estado el botón pulsado desaparece: el foco pasa a la tarjeta
  useEffect(() => {
    if (seen.current === st) return;
    seen.current = st;
    const a = document.activeElement;
    if (!a || a === document.body || root.current?.contains(a)) root.current?.focus();
  }, [st]);
  useEffect(() => { if (edit) first.current?.focus(); }, [edit]);

  const accept = async () => {
    if (lock.current || st !== 'pending' || edit) return; // doble toque: una sola escritura (applyProposal también es idempotente)
    lock.current = true;
    patch(m.id, { pstate: 'saving', perr: undefined });
    try {
      await applyProposal(app.vault, app.col, p, m.id);
      patch(m.id, { pstate: 'saved' });
      app.changed();
    } catch (e) {
      patch(m.id, { pstate: 'pending', perr: werr(e), pdet: tech(e) });
    } finally { lock.current = false; }
  };
  const undo = async () => {
    if (lock.current || st !== 'saved') return;
    lock.current = true;
    try {
      const r = await undoProposal(app.vault, m.id);
      patch(m.id, { pstate: 'undone', code: r.emptied.length ? 'emptied' : undefined });
      app.changed();
    } catch (e) { patch(m.id, { perr: e instanceof Error && e.message === 'changed' ? 'changed' : werr(e), pdet: tech(e) }); } finally { lock.current = false; }
  };
  const open = () => { setErr(''); setText(p.contenido); setEv(p.evento ?? null); setEdit(true); };
  const check = () => {
    const r = revalidate(p, p.tipo === 'evento' ? { evento: ev ?? {} } : { contenido: text });
    if (isBad(r)) { setErr(`${t(`chat.pv_err_${r.error}`)}${r.detail ? ` — ${r.detail}` : ''}`); return; }
    patch(m.id, { proposal: r });
    setEdit(false); setErr('');
    queueMicrotask(() => editBtn.current?.focus());
  };

  const title = p.tipo === 'evento' ? t(p.op ? 'chat.pv_t_evento_mod' : 'chat.pv_t_evento') : t(TITLE[p.tipo], { dest: p.mazo ?? p.destino.replace(/^.*\//, '').replace(/\.md$/, '') });
  const busy = st === 'saving';
  return (
    <section ref={root} class="chat-pv" tabIndex={-1} aria-label={title}>
      <b class="chat-pv-t">{title}</b>
      {(st === 'pending' || st === 'saving') && <p class="foot">{t('chat.pv_aviso')}</p>}
      {edit ? (
        <div class="stack-s">
          {p.tipo === 'evento' && ev
            ? FIELDS.map((k, i) => (
              <label key={k} class="field">{t(`chat.pv_campo_${k}`)}
                <input ref={i === 0 ? (first as { current: HTMLInputElement | null }) : undefined} class="input" type={(TYPE[k] ?? 'text') as 'text'} value={ev[k]} onInput={(e) => setEv({ ...ev, [k]: (e.currentTarget as HTMLInputElement).value })} />
              </label>))
            : <label class="field">{t('chat.pv_texto')}
              <textarea ref={first as { current: HTMLTextAreaElement | null }} class="input" rows={10} value={text} onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} />
            </label>}
        </div>
      ) : (
        <ul class="chat-pv-list" data-user-content>{p.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      )}
      {err && <p class="chat-pv-err" role="alert">{err}</p>}
      {m.perr && st === 'pending' && <p class="chat-pv-err" role="alert">{t(`chat.pv_werr_${m.perr}`)}{m.perr === 'other' && m.pdet && <small class="foot" style={{ display: 'block', fontWeight: 400 }} data-user-content>{m.pdet}</small>}</p>}
      {st === 'pending' || st === 'saving' ? (
        <div class="chat-pv-act">
          {edit
            ? <button type="button" class="btn primary" aria-label={t('chat.pv_revisar')} onClick={check}><Check size={18} aria-hidden="true" /> {t('chat.pv_revisar')}</button>
            : <button type="button" class="btn primary" aria-label={t('chat.pv_aceptar')} disabled={busy} onClick={() => void accept()}><Check size={18} aria-hidden="true" /> {busy ? t('chat.pv_guardando') : t('chat.pv_aceptar')}</button>}
          {!edit && <button ref={editBtn} type="button" class="btn" aria-label={t('chat.pv_editar')} disabled={busy} onClick={open}><Pencil size={18} aria-hidden="true" /> {t('chat.pv_editar')}</button>}
          <button type="button" class="btn" aria-label={t('chat.pv_cancelar')} disabled={busy} onClick={() => patch(m.id, { pstate: 'canceled' })}><X size={18} aria-hidden="true" /> {t('chat.pv_cancelar')}</button>
        </div>
      ) : st === 'saved' ? (
        <div class="chat-pv-act" role="status">
          <span class="chat-pv-ok">{t('chat.pv_guardado', { resumen: p.resumen })}</span>
          <button type="button" class="btn" aria-label={t('chat.pv_deshacer')} onClick={() => void undo()}><Undo2 size={18} aria-hidden="true" /> {t('chat.pv_deshacer')}</button>
          {m.perr && <span class="chat-pv-err">{t(`chat.pv_werr_${m.perr}`)}</span>}
        </div>
      ) : (
        <p class="foot" role="status">{st === 'canceled' ? t('chat.pv_cancelado') : t(m.code === 'emptied' ? 'chat.pv_deshecho_vacio' : 'chat.pv_deshecho')}</p>
      )}
    </section>
  );
}
