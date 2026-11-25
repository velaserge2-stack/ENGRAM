// Ajustes → Asistente (Fase 1b). Se carga con import() solo al abrir la sección con el add-on encendido.
// La clave nunca aparece en toasts, errores ni registros: los mensajes salen del tipo de error (t('chat.err_*')).
import { GripVertical, Plus, List, Pause, Play, Plug, Trash2, ArrowUp, ArrowDown } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { classify, techLine, type Detail, type Kind } from '../chat/errors';
import { loadKeys, markKey, mask, MAX_KEYS, saveKeys, USAGE_RESET, type KeyEntry, type KeyStore } from '../chat/keys';
import { loadCore, loadModel, modelOf, PROVIDERS, setModels, type ProviderId } from '../chat/providers';
import { listModels, LIST_MS } from '../chat/models';
import { bar, fromHeaders, loadUsage, realLine, saveUsage, setAcct, setHdr } from '../chat/usage';
import { fetchAcct, hasAcct } from '../chat/account';
import { busy } from '../chat/session';
import { normModel, type ChatLimits } from '../lib/settings';
import { useApp } from '../state';
import { AddKeySheet } from '../chat/addkey';
import { useTick } from '../chat/tick';
import { Row } from '../ui/kit';
import { usePressDrag } from '../ui/pressdrag';

const IDS = Object.keys(PROVIDERS) as ProviderId[];
const TEST_MS = 20_000;
// claves literales (el test de i18n las busca por texto)
const ST = () => ({ active: t('chat.st_active'), exhausted: t('chat.st_exhausted'), invalid: t('chat.st_invalid'), paused: t('chat.st_paused') });
const ERR = (): Record<Kind, string> => ({ quota: t('chat.err_quota'), rate: t('chat.err_rate'), auth: t('chat.err_auth'), model: t('chat.err_model'), limit: t('chat.p_err_limit'), timeout: t('chat.err_timeout'), network: t('chat.err_network'), server: t('chat.err_server'), aborted: t('chat.err_aborted'), empty: t('chat.p_err_empty'), other: t('chat.err_other') });
const LIM = (): Record<keyof ChatLimits, string> => ({ rpm: t('chat.lim_rpm'), rpd: t('chat.lim_rpd'), tpm: t('chat.lim_tpm'), tpd: t('chat.lim_tpd') });

async function probe(k: KeyEntry, signal: AbortSignal): Promise<{ kind: 'ok' | Kind; resetAt?: number; detail?: Detail; headers?: Record<string, string> }> {
  try {
    const [core, model] = await Promise.all([loadCore(), loadModel(k.provider, k.key)]);
    const r = await core.generateText({ model, prompt: 'ok', maxOutputTokens: 8, maxRetries: 0, abortSignal: signal });
    return { kind: 'ok', headers: r.response?.headers };
  } catch (e) {
    return signal.aborted ? { kind: 'aborted' } : classify(k.provider, e, Date.now(), [k.key]);
  }
}

export function AssistantBody() {
  const app = useApp();
  const s = app.settings;
  setModels(s.chat.models, s.chat.context); // la prueba y la lista usan el modelo elegido
  const [store, setStore] = useState<KeyStore>(loadKeys);
  const [adding, setAdding] = useState(false);
  useTick();
  const [test, setTest] = useState<{ id: string; kind: 'busy' | 'ok' | Kind; detail?: Detail; groq?: boolean } | null>(null);
  const [lst, setLst] = useState<{ id: string; busy?: boolean; ids?: string[]; suggested?: string; kind?: Kind; detail?: Detail } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const live = useRef<HTMLDivElement>(null);
  const put = (n: KeyStore) => { saveKeys(n); setStore(n); };
  const move = (id: string, to: number) => {
    const from = store.keys.findIndex((k) => k.id === id);
    if (from < 0 || to < 0 || to >= store.keys.length || from === to) return;
    const keys = [...store.keys];
    keys.splice(to, 0, keys.splice(from, 1)[0]!);
    put({ v: 1, keys });
    const a = store.keys[from]!.alias;
    if (live.current) live.current.textContent = t('chat.movida', { alias: a, n: to + 1 });
  };
  const pd = usePressDrag<string>({
    onMenu: () => {},
    onDrop: (id, dest) => { if (dest.startsWith('k:')) move(id, store.keys.findIndex((k) => k.id === dest.slice(2))); },
    label: (id) => store.keys.find((k) => k.id === id)?.alias ?? '',
  });

  const run = async (k: KeyEntry) => {
    if (abort.current) return abort.current.abort();
    if (busy()) return; // un turno en curso: una sola petición a la vez
    const ac = new AbortController();
    abort.current = ac;
    const timer = setTimeout(() => ac.abort(), TEST_MS);
    setTest({ id: k.id, kind: 'busy' });
    const r = await probe(k, ac.signal);
    clearTimeout(timer);
    abort.current = null;
    // cifras reales: Groq en las cabeceras de esta misma respuesta; OpenRouter y Kimi con su consulta de cuenta
    let groq: boolean | undefined;
    if (r.kind === 'ok' && k.provider === 'groq') {
      const h = fromHeaders('groq', r.headers, Date.now());
      groq = !!h;
      if (h) saveUsage(setHdr(loadUsage(), k.id, h));
    }
    if (r.kind === 'ok' && hasAcct(k.provider)) saveUsage(setAcct(loadUsage(), k.id, await fetchAcct(k.provider, k.key, ac.signal)));
    setTest({ id: k.id, kind: r.kind, detail: r.detail, groq });
    const cur = loadKeys();
    if (r.kind === 'ok') { if (k.status === 'invalid' || k.status === 'exhausted') put(markKey(cur, k.id, 'active')); }
    else if (r.kind === 'auth') put(markKey(cur, k.id, r.detail?.status === 403 ? 'paused' : 'invalid')); // 403 ambiguo (región/permisos): se pausa, como en la sesión
    else if (r.kind === 'quota') put(markKey(cur, k.id, 'exhausted', r.resetAt ?? Date.now() + 3_600_000));
  };
  const listFor = async (k: KeyEntry) => {
    if (abort.current) return abort.current.abort();
    if (busy()) return;
    const ac = new AbortController();
    abort.current = ac;
    const timer = setTimeout(() => ac.abort(), LIST_MS);
    setLst({ id: k.id, busy: true });
    const r = await listModels(k.provider, k.key, ac.signal);
    clearTimeout(timer);
    abort.current = null;
    if (r.ok) setLst({ id: k.id, ids: r.ids, suggested: r.suggested });
    else setLst({ id: k.id, kind: r.c.kind, detail: r.c.detail });
  };
  const setModel = (p: ProviderId, v: string) => {
    const m = { ...s.chat.models }, n = normModel(v);
    if (n) m[p] = n; else delete m[p];
    app.update({ chat: { ...s.chat, models: m } });
  };
  const forget = () => {
    if (!confirm(t('chat.olvidar_confirm'))) return;
    put({ v: 1, keys: [] });
    for (const n of USAGE_RESET) try { localStorage.removeItem(n); } catch { /* sin acceso */ }
    setTest(null);
    app.toast(t('chat.olvidadas'));
  };
  const setLim = (p: ProviderId, f: keyof ChatLimits, v: string) => {
    const n = Math.max(1, Math.round(Number(v)));
    if (!Number.isFinite(n)) return;
    app.update({ chat: { ...s.chat, limits: { ...s.chat.limits, [p]: { ...s.chat.limits[p], [f]: n } } } });
  };
  const usage = loadUsage();
  const full = store.keys.length >= MAX_KEYS;
  const stLabel = (k: KeyEntry) => k.status === 'exhausted' && k.until !== undefined && k.until <= Date.now() ? ST().active : k.status === 'exhausted' && k.until ? t('chat.st_exhausted_hasta', { h: new Date(k.until).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) }) : ST()[k.status];

  return (
    <>
      <div ref={live} class="sr-only" role="status" aria-live="polite" />
      <div class="row-i"><div class="k"><strong>{t('chat.claves')}</strong><small>{t('chat.claves_sub', { n: MAX_KEYS })}</small></div></div>
      {!store.keys.length && <Row k={t('chat.sin_claves')} />}
      {store.keys.map((k, i) => {
        const b = bar(usage, k.id, s.chat.limits[k.provider], Date.now(), s.chat.warnAt, k.provider);
        const tt = test?.id === k.id ? test.kind : null;
        return (
          <div class="row-i chat-key" key={k.id} data-drop={'k:' + k.id} style={{ flexWrap: 'wrap' }} {...pd.bind(k.id)}>
            <GripVertical size={18} aria-hidden="true" class="t3" />
            <div class="k" style={{ minWidth: '9rem', flex: '1 1 10rem' }}>
              <span data-user-content>{k.alias}</span>
              <small>{PROVIDERS[k.provider].name} · <code>{mask(k.key)}</code> · {stLabel(k)}</small>
              <div class="bar" role="progressbar" aria-label={t('chat.uso')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.pct * 100)} style={{ marginTop: '6px' }}><i style={{ width: `${Math.round(b.pct * 100)}%` }} /></div>
              <small>{t('chat.uso')}: {b.label}{b.show && <> · <strong>{b.level === 'full' ? t('chat.uso_lleno') : t('chat.uso_cerca')}</strong></>}</small>
              {(() => { const real = realLine(usage, k.id, k.provider); return real ? <small class="mono">{t('chat.real_titulo')}: {real}</small> : null; })()}
              {tt === 'ok' && test?.groq !== undefined && <small role="status">{test.groq ? t('chat.groq_cifras_ok') : t('chat.groq_cifras_no')}</small>}
              {tt && <small role="status">{tt === 'busy' ? t('chat.probando') : tt === 'ok' ? t('chat.conexion_ok') : tt === 'model' ? t('chat.err_model', { modelo: modelOf(k.provider) }) : ERR()[tt]}</small>}
              {tt && tt !== 'busy' && tt !== 'ok' && test?.detail && <small role="status" aria-live="polite" class="chat-tech">{techLine(test.detail)}</small>}
            </div>
            <div class="row" style={{ gap: '4px', flexWrap: 'wrap' }}>
              <button type="button" class="btn icon" aria-label={t('chat.subir', { alias: k.alias })} disabled={i === 0} onClick={() => move(k.id, i - 1)}><ArrowUp size={18} aria-hidden="true" /></button>
              <button type="button" class="btn icon" aria-label={t('chat.bajar', { alias: k.alias })} disabled={i === store.keys.length - 1} onClick={() => move(k.id, i + 1)}><ArrowDown size={18} aria-hidden="true" /></button>
              <button type="button" class="btn" onClick={() => void run(k)} disabled={abort.current ? tt !== 'busy' : busy()}><Plug size={16} aria-hidden="true" />{' '}{tt === 'busy' ? t('chat.cancelar_prueba') : t('chat.probar')}</button>
              <button type="button" class="btn" onClick={() => void listFor(k)} disabled={abort.current ? !(lst?.id === k.id && lst.busy) : busy()}><List size={16} aria-hidden="true" />{' '}{lst?.id === k.id && lst.busy ? t('chat.cancelar_prueba') : t('chat.ver_modelos')}</button>
              {k.status === 'paused'
                ? <button type="button" class="btn" onClick={() => put(markKey(store, k.id, 'active'))}><Play size={16} aria-hidden="true" />{' '}{t('chat.reactivar')}</button>
                : <button type="button" class="btn" onClick={() => put(markKey(store, k.id, 'paused'))}><Pause size={16} aria-hidden="true" />{' '}{t('chat.pausar')}</button>}
              {k.status === 'invalid' && <button type="button" class="btn" onClick={() => put(markKey(store, k.id, 'active'))}>{t('chat.reactivar')}</button>}
              <button type="button" class="btn icon danger" aria-label={t('chat.borrar', { alias: k.alias })} onClick={() => { if (confirm(t('chat.borrar_confirm', { alias: k.alias }))) put({ v: 1, keys: store.keys.filter((x) => x.id !== k.id) }); }}><Trash2 size={18} aria-hidden="true" /></button>
            </div>
            {lst?.id === k.id && (
              <div style={{ flexBasis: '100%' }} role="status" aria-live="polite" class="chat-models">
                {lst.busy && <small>{t('chat.listando')}</small>}
                {lst.kind && <><small>{lst.kind === 'aborted' ? t('chat.err_aborted') : ERR()[lst.kind]}</small>{lst.detail && lst.kind !== 'aborted' && <small class="chat-tech">{techLine(lst.detail)}</small>}</>}
                {lst.ids && !lst.ids.length && <small>{t('chat.modelos_vacio')}</small>}
                {!!lst.ids?.length && <>
                  <small>{t('chat.modelos_n', { n: lst.ids.length })}</small>
                  <div class="col" style={{ gap: '4px', maxHeight: '15rem', overflowY: 'auto' }}>
                    {lst.ids.map((id) => (
                      <button type="button" class="btn" key={id} aria-pressed={modelOf(k.provider) === id} style={{ minHeight: '44px', justifyContent: 'flex-start' }} onClick={() => setModel(k.provider, id)}>
                        <code>{id}</code>{id === lst.suggested && <small>{' · '}{t('chat.sugerido')}</small>}
                      </button>
                    ))}
                  </div>
                  <small>{t('chat.modelo_actual', { modelo: modelOf(k.provider) })}</small>
                  <button type="button" class="btn" onClick={() => void run(k)} disabled={!!abort.current || busy()}><Plug size={16} aria-hidden="true" />{' '}{t('chat.probar')}</button>
                </>}
              </div>
            )}
            {tt === 'model' && <small class="t3" style={{ flexBasis: '100%' }}>{t('chat.sugerir_modelos')}</small>}
          </div>
        );
      })}
      {pd.ghost}

      <div class="row-i" style={{ flexWrap: 'wrap' }}>
        <button type="button" class="btn primary" disabled={full} onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />{' '}{t('chat.anadir')}</button>
        {full && <small class="t3" style={{ flexBasis: '100%' }}>{t('chat.maximo', { n: MAX_KEYS })}</small>}
      </div>
      {adding && <AddKeySheet onClose={() => setAdding(false)} onAdded={setStore} />}

      <div class="row-i"><div class="k"><strong>{t('chat.limites')}</strong><small>{t('chat.limites_sub')}</small></div></div>
      {IDS.map((p) => (
        <div class="row-i" key={p} style={{ flexWrap: 'wrap' }}>
          <div class="k" style={{ minWidth: '6rem' }}>{PROVIDERS[p].name}</div>
          {(['rpm', 'rpd', 'tpm', ...(PROVIDERS[p].limits.tpd ? ['tpd'] : [])] as (keyof ChatLimits)[]).map((f) => (
            <label class="field" style={{ flex: '1 1 6rem', minWidth: 0 }}>{LIM()[f]}
              <input class="input" type="number" inputMode="numeric" min={1} value={s.chat.limits[p][f] ?? ''} onChange={(e) => setLim(p, f, (e.target as HTMLInputElement).value)} style={{ width: '100%' }} />
            </label>
          ))}
        </div>
      ))}
      <div class="row-i"><div class="k"><strong>{t('chat.modelo')}</strong><small>{t('chat.modelo_sub')}</small></div></div>
      {IDS.map((p) => (
        <div class="row-i" key={p} style={{ flexWrap: 'wrap' }}>
          <div class="k" style={{ minWidth: '6rem' }}>{PROVIDERS[p].name}</div>
          <input class="input" aria-label={t('chat.modelo_de', { nombre: PROVIDERS[p].name })} placeholder={PROVIDERS[p].model} maxLength={80} autocomplete="off" autocapitalize="none" spellcheck={false} defaultValue={s.chat.models[p] ?? ''} key={s.chat.models[p] ?? ''} onChange={(e) => setModel(p, (e.target as HTMLInputElement).value)} style={{ flex: '1 1 12rem', minWidth: 0 }} />
        </div>
      ))}
      <Row k={t('chat.avisar_en')} sub={t('chat.avisar_en_sub')}>
        <select aria-label={t('chat.avisar_en')} value={String(s.chat.warnAt)} onChange={(e) => app.update({ chat: { ...s.chat, warnAt: Number((e.target as HTMLSelectElement).value) } })}>{[0.6, 0.7, 0.8, 0.9].map((v) => <option value={String(v)}>{Math.round(v * 100)} %</option>)}</select>
      </Row>

      <Row k={t('chat.contexto')} sub={t('chat.contexto_sub')}>
        <select aria-label={t('chat.contexto')} value={s.chat.context} onChange={(e) => app.update({ chat: { ...s.chat, context: (e.target as HTMLSelectElement).value === 'amplio' ? 'amplio' : 'normal' } })}><option value="normal">{t('chat.contexto_normal')}</option><option value="amplio">{t('chat.contexto_amplio')}</option></select>
      </Row>

      <Row k={t('chat.estilo')} sub={t('chat.estilo_sub')}>
        <select aria-label={t('chat.estilo')} value={s.chat.estilo} onChange={(e) => app.update({ chat: { ...s.chat, estilo: (e.target as HTMLSelectElement).value === 'b' ? 'b' : 'a' } })}><option value="a">{t('chat.estilo_a')}</option><option value="b">{t('chat.estilo_b')}</option></select>
      </Row>

      <div class="row-i"><div class="k"><strong>{t('chat.privacidad')}</strong>
        <small>{t('chat.priv_gemini')}</small><small>{t('chat.priv_groq')}</small><small>{t('chat.priv_openrouter')}</small><small>{t('chat.priv_kimi')}</small><small>{t('chat.priv_consejo')}</small><small>{t('chat.priv_local')}</small><small>{t('voz.priv')}</small></div></div>
      <Row k={t('chat.olvidar')} sub={t('chat.olvidar_sub')}><button type="button" class="btn danger" onClick={forget} disabled={!store.keys.length}>{t('chat.olvidar')}</button></Row>
    </>
  );
}
