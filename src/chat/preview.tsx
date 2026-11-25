// Vista previa de una propuesta de escritura del Asistente: Aceptar escribe (por SafeVault), Editar revalida, Cancelar no escribe.
// Todo se pinta como TEXTO (Preact escapa); nada de innerHTML. El deshacer queda visible hasta «Nueva conversación».
import { Check, Pencil, Trash2, Undo2, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, tn } from '../i18n';
import { dayKey } from '../lib/days';
import { parseFrontmatter } from '../lib/frontmatter';
import { renderMarkdown } from '../md/render';
import { useApp } from '../state';
import { redact } from './errors';
import { type Msg, patch } from './history';
import { applyProposal, type EventFields, isBad, revalidate, undoProposal } from './proposal';

const TITLE: Record<'tarjetas' | 'examen' | 'evento' | 'nota' | 'diagrama' | 'fecha' | 'edicion', string> = { edicion: 'asist2.pv_t_edicion', tarjetas: 'chat.pv_t_tarjetas', examen: 'chat.pv_t_examen', evento: 'chat.pv_t_evento', nota: 'chat.pv_t_nota', diagrama: 'chat.pv_t_diagrama', fecha: 'chat.pv_t_fecha' } as const;
const NEWFILE = new Set(['nota', 'diagrama', 'fecha']);

/** Vista del diagrama propuesto con el visor de siempre, cargado bajo demanda; si falla, queda el código. */
function DiagramPeek({ kind, src }: { kind: string; src: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let off = () => undefined as void, dead = false;
    void import('../diagrams/mount').then((m) => { if (!dead && host.current) off = m.mountDiagrams(host.current); }).catch(() => undefined);
    return () => { dead = true; off(); };
  }, [kind, src]);
  return <div ref={host} class="diag-host chat-pv-diag" role="group" aria-label={t('chat.pv_vista_diagrama')} data-kind={kind} data-src={src} data-user-content />;
}
const FIELDS = ['titulo', 'fecha', 'inicio', 'fin', 'materia', 'nota'] as const;
const TYPE: Record<string, 'date' | 'time'> = { fecha: 'date', inicio: 'time', fin: 'time' };

/** Código de aviso (i18n `chat.pv_werr_*`) de un fallo al guardar; los DOMException de almacenamiento tienen mensaje propio. */
const werr = (e: unknown): string => {
  const n = e instanceof Error ? (e.name === 'Error' ? e.message : e.name) : '';
  return ({ open: 'open', changed: 'changed', exists: 'exists', gone: 'gone', QuotaExceededError: 'quota', NotAllowedError: 'denied', SecurityError: 'denied', NotFoundError: 'notfound' } as Record<string, string>)[n] ?? 'other';
};
/** «Nombre: mensaje» corto y sin claves, para diagnosticar fallos no clasificados. */
const tech = (e: unknown): string => redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(/\s+/g, ' ').slice(0, 160);

/** Las propuestas de borrado tienen su propia tarjeta (confirmación explícita, foco en Cancelar). */
export function Preview({ m }: { m: Msg }) {
  return m.proposal!.tipo === 'borrar' ? <DeleteCard m={m} /> : <WritePreview m={m} />;
}

function WritePreview({ m }: { m: Msg }) {
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

  const refresh = () => (p.tipo === 'nota' || p.tipo === 'diagrama' || (p.tipo === 'edicion' && p.destino.startsWith('notes/')) ? app.changed('notes') : app.changed());
  const accept = async () => {
    if (lock.current || st !== 'pending' || edit) return; // doble toque: una sola escritura (applyProposal también es idempotente)
    lock.current = true;
    patch(m.id, { pstate: 'saving', perr: undefined });
    try {
      await applyProposal(app.vault, app.col, p, m.id);
      patch(m.id, { pstate: 'saved' });
      refresh();
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
      refresh();
    } catch (e) { patch(m.id, { perr: e instanceof Error && e.message === 'changed' ? 'changed' : werr(e), pdet: tech(e) }); } finally { lock.current = false; }
  };
  const open = () => { setErr(''); setText(p.contenido); setEv(p.evento ?? null); setEdit(true); };
  const check = () => {
    const r = revalidate(p, p.tipo === 'evento' ? { evento: ev ?? {} } : { contenido: text }, { col: app.col, today: dayKey(Date.now(), app.settings.timeZone, app.settings.dayStartHour) });
    if (isBad(r)) { setErr(`${t(`chat.pv_err_${r.error}`)}${r.detail ? ` — ${r.detail}` : ''}`); return; }
    patch(m.id, { proposal: r });
    setEdit(false); setErr('');
    queueMicrotask(() => editBtn.current?.focus());
  };

  const title = p.tipo === 'evento' ? t(p.op ? 'chat.pv_t_evento_mod' : 'chat.pv_t_evento') : t(TITLE[p.tipo as keyof typeof TITLE], { dest: p.mazo ?? p.destino.replace(/^.*\//, '').replace(/\.md$/, '') });
  const busy = st === 'saving';
  return (
    <section ref={root} class="chat-pv" tabIndex={-1} aria-label={title} aria-live="polite">
      <b class="chat-pv-t" data-user-content>{title}</b>
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
        <>
          {NEWFILE.has(p.tipo) && <p class="foot" data-user-content>{t('chat.pv_ruta', { ruta: p.destino })}</p>}
          {p.tipo === 'nota' && <div class="chat-pv-md md" tabIndex={0} role="region" aria-label={t('chat.pv_vista_nota')} data-user-content dangerouslySetInnerHTML={{ __html: renderMarkdown(parseFrontmatter(p.contenido).body.slice(0, 6000)) }} />}
          {p.tipo === 'diagrama' && <><DiagramPeek kind={p.diag ?? 'mapa'} src={parseFrontmatter(p.contenido).body} /><details><summary>{t('chat.pv_codigo')}</summary><pre class="chat-pv-code" tabIndex={0} data-user-content>{parseFrontmatter(p.contenido).body}</pre></details></>}
          {p.tipo === 'fecha' && <p class="foot" data-user-content>{t('chat.pv_faltan', { n: `${p.datos?.dias ?? 0} ${tn('plural.daysword', p.datos?.dias ?? 0)}`, fecha: p.items[1] ?? '' })}</p>}
          {(p.tipo === 'fecha' || !NEWFILE.has(p.tipo)) && <ul class="chat-pv-list" data-user-content>{p.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </>
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
        <p class="foot" role="status">{st === 'canceled' ? t('chat.pv_cancelado') : t(m.code === 'emptied' ? 'chat.pv_deshecho_vacio' : p.tipo === 'nota' || p.tipo === 'diagrama' ? 'chat.pv_deshecho_nota' : p.tipo === 'fecha' ? 'chat.pv_deshecho_quitado' : 'chat.pv_deshecho')}</p>
      )}
    </section>
  );
}

const DERR: Record<string, string> = { changed: 'changed', gone: 'gone', open: 'open' };
const derr = (e: unknown) => DERR[e instanceof Error ? e.message : ''] ?? 'other';

/** «Confirmar borrado»: nada se mueve hasta pulsar «Mover a la papelera»; no hay atajos ni Enter global; el foco inicial va en «Cancelar». */
function DeleteCard({ m }: { m: Msg }) {
  const app = useApp();
  const p = m.proposal!;
  const st = m.pstate ?? 'pending';
  const lock = useRef(false);
  const root = useRef<HTMLElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const seen = useRef(st);
  useEffect(() => { if (st === 'pending') cancel.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (seen.current === st) return;
    seen.current = st;
    const a = document.activeElement;
    if (!a || a === document.body || root.current?.contains(a)) root.current?.focus();
  }, [st]);
  const refresh = () => (p.objetivo === 'nota' ? app.changed('notes') : app.changed());
  const confirm = async () => {
    if (lock.current || st !== 'pending') return;
    lock.current = true;
    patch(m.id, { pstate: 'saving', perr: undefined });
    try {
      await applyProposal(app.vault, app.col, p, m.id);
      patch(m.id, { pstate: 'saved' });
      refresh();
    } catch (e) { patch(m.id, { pstate: 'pending', perr: derr(e), pdet: tech(e) }); } finally { lock.current = false; }
  };
  const undo = async () => {
    if (lock.current || st !== 'saved') return;
    lock.current = true;
    try { await undoProposal(app.vault, m.id); patch(m.id, { pstate: 'undone', perr: undefined }); refresh(); } catch (e) { patch(m.id, { perr: derr(e), pdet: tech(e) }); } finally { lock.current = false; }
  };
  const d = p.datos ?? {}, days = app.settings.deckTrashDays;
  const info = p.objetivo === 'nota' ? t('chat.dl_info_nota', { n: d.chars ?? 0 })
    : p.objetivo === 'mazo' ? t('chat.dl_info_mazo', { cards: d.cards ?? 0, reviews: d.reviews ?? 0 })
    : p.objetivo === 'banco' ? t('chat.dl_info_banco', { n: d.questions ?? 0 })
    : t(d.serie ? 'chat.dl_info_evento_serie' : 'chat.dl_info_evento_uno');
  const name = p.resumen, busy = st === 'saving';
  const title = t('chat.dl_titulo', { nombre: name });
  return (
    <section ref={root} class="chat-pv chat-dl" tabIndex={-1} aria-label={title} aria-live="polite">
      <b class="chat-pv-t" data-user-content>{title}</b>
      {(st === 'pending' || st === 'saving') && (<>
        <p class="foot">{t(`chat.dl_obj_${p.objetivo}`)}</p>
        <ul class="chat-pv-list" data-user-content>{p.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <p class="foot">{info}</p>
        <p style={{ fontWeight: 600 }}>{t('chat.dl_aviso')} {p.objetivo === 'evento' ? '' : p.objetivo === 'nota' || !days ? t('chat.dl_sin_purga') : t('chat.dl_purga', { n: days })}</p>
        {p.objetivo === 'mazo' && <p class="foot">{t('chat.dl_sin_sub')}</p>}
        {p.objetivo !== 'evento' && <p class="foot">{t('chat.dl_rotos')}</p>}
      </>)}
      {m.perr && st !== 'undone' && <p class="chat-pv-err" role="alert">{t(`chat.dl_err_${m.perr}`)}{m.perr === 'other' && m.pdet && <small class="foot" style={{ display: 'block', fontWeight: 400 }} data-user-content>{m.pdet}</small>}</p>}
      {st === 'pending' || st === 'saving' ? (
        <div class="chat-pv-act">
          <button ref={cancel} type="button" class="btn primary" aria-label={t('chat.dl_cancelar')} disabled={busy} onClick={() => patch(m.id, { pstate: 'canceled' })}><X size={18} aria-hidden="true" /> {t('chat.dl_cancelar')}</button>
          <button type="button" class="btn" aria-label={t('chat.dl_confirmar')} disabled={busy} onClick={() => void confirm()}><Trash2 size={18} aria-hidden="true" /> {busy ? t('chat.dl_moviendo') : t('chat.dl_confirmar')}</button>
        </div>
      ) : st === 'saved' ? (
        <div class="chat-pv-act" role="status">
          <span class="chat-pv-ok" data-user-content>{t('chat.dl_hecho', { nombre: name })}</span>
          <button type="button" class="btn" aria-label={t('chat.dl_deshacer')} onClick={() => void undo()}><Undo2 size={18} aria-hidden="true" /> {t('chat.dl_deshacer')}</button>
        </div>
      ) : (
        <p class="foot" role="status">{t(st === 'canceled' ? 'chat.dl_cancelado' : 'chat.dl_deshecho')}</p>
      )}
    </section>
  );
}
