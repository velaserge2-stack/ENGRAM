import { ChevronDown, ChevronLeft, List, Plus } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { normModel } from '../lib/settings';
import { go, useApp } from '../state';
import { Popover } from '../ui/overlay';
import { techLine, type Classified } from './errors';
import { loadKeys, mask, MAX_KEYS, saveKeys, type KeyEntry } from './keys';
import { AddKeySheet } from './addkey';
import { listModels, LIST_MS } from './models';
import { PROVIDERS, type ProviderId } from './providers';
import { bar, loadUsage } from './usage';
import { ProviderLogo } from './logos';

/** Modelos ya pedidos con «Ver modelos disponibles» (solo ids públicos; la clave nunca se guarda aquí). */
const fetched: Partial<Record<ProviderId, string[]>> = {};
let inflight: AbortController | null = null; // una petición a la vez

const usable = (k: KeyEntry, now: number) => k.status === 'active' || (k.status === 'exhausted' && k.until !== undefined && k.until <= now);
const ST = (k: KeyEntry) => t(`chat.st_${k.status}`);

/** «Modelo y claves» dentro de la pestaña: elegir clave = ponerla la primera (misma lista y orden que Ajustes); elegir modelo = settings.chat.models. */
export function KeyView(p: { onBack: () => void; onChange: () => void }) {
  const app = useApp();
  const [store, setStore] = useState(() => loadKeys());
  const [live, setLive] = useState('');
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [lst, setLst] = useState<{ busy?: boolean; err?: Classified } | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = useRef<HTMLDivElement>(null);
  const now = Date.now(), keys = store.keys;
  const modelOf = (prov: ProviderId) => app.settings.chat.models[prov] || PROVIDERS[prov].model; // lo elegido en Ajustes o el de fábrica
  const cur = keys.find((k) => usable(k, now)) ?? keys[0];

  const choose = (k: KeyEntry) => {
    if (!usable(k, now)) return;
    if (k.id !== keys[0]?.id) {
      const next = { v: 1 as const, keys: [k, ...keys.filter((x) => x.id !== k.id)] };
      saveKeys(next); setStore(next); p.onChange();
    }
    setLive(t('dock.ahora', { alias: k.alias }));
  };
  const setModel = (prov: ProviderId, v: string) => {
    const m = { ...app.settings.chat.models }, n = normModel(v);
    if (n) m[prov] = n; else delete m[prov];
    app.update({ chat: { ...app.settings.chat, models: m } });
    setMenu(null);
  };
  const list = async () => {
    if (inflight) return inflight.abort();
    const k = cur;
    if (!k) return;
    const ac = (inflight = new AbortController());
    const timer = setTimeout(() => ac.abort(), LIST_MS);
    setLst({ busy: true });
    const r = await listModels(k.provider, k.key, ac.signal);
    clearTimeout(timer); inflight = null;
    if (r.ok) { fetched[k.provider] = r.ids; setLst(null); } else setLst({ err: r.c });
  };
  const arrows = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const all = [...(rows.current?.querySelectorAll<HTMLElement>('[role=radio]:not([aria-disabled=true])') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    all[(i + d + all.length) % all.length]?.focus();
  };
  const optionsOf = (prov: ProviderId) => [...new Set([modelOf(prov), PROVIDERS[prov].model, ...(fetched[prov] ?? [])])];

  return (
    <>
      <div class="gx-qh">
        <button type="button" class="gx-ib" aria-label={t('dock.volver')} onClick={p.onBack}><ChevronLeft size={20} aria-hidden="true" /></button>
        <span>{t('dock.modelo_claves')}</span>
      </div>
      {keys.length === 0
        ? <div class="gx-kempty"><b>{t('dock.sin_claves')}</b><button type="button" class="gx-qc add" onClick={() => setAdding(true)}>{t('dock.anadir_clave')}</button></div>
        : (
          <div class="gx-krows" role="radiogroup" aria-label={t('dock.modelo_claves')} ref={rows} onKeyDown={arrows}>
            {keys.map((k) => {
              const ok = usable(k, now), on = k.id === cur?.id;
              const u = bar(loadUsage(), k.id, app.settings.chat.limits[k.provider], now, app.settings.chat.warnAt, k.provider);
              return (
                <div class={`gx-krow${ok ? '' : ' off'}`} key={k.id}>
                  <button type="button" role="radio" class="gx-kmain" aria-checked={on} aria-disabled={!ok} tabIndex={on || (!cur && ok) ? 0 : -1} onClick={() => choose(k)}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choose(k); } }}>
                    <span class="gx-dot" aria-hidden="true" /><span class="gx-lg" data-provider={k.provider}><ProviderLogo provider={k.provider} size={12} /></span>
                    <span class="gx-kt"><b data-user-content>{k.alias}</b><small>{PROVIDERS[k.provider].name} · <span class="mono">{mask(k.key)} · {ok ? u.label : ST(k)}</span></small></span>
                  </button>
                  <button type="button" class="gx-mdl" aria-haspopup="menu" aria-label={`${t('dock.modelo_de', { alias: k.alias })}: ${modelOf(k.provider)}`} onClick={(e) => setMenu({ id: k.id, el: e.currentTarget as HTMLElement })}>
                    <span class="mono">{modelOf(k.provider)}</span><ChevronDown size={14} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      <div class="gx-kfoot">
        {keys.length > 0 && keys.length < MAX_KEYS && <button type="button" class="gx-qc" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" />{t('dock.anadir_clave')}</button>}
        <button type="button" class="gx-qc" disabled={!keys.length} onClick={() => void list()}><List size={14} aria-hidden="true" />{lst?.busy ? t('chat.cancelar_prueba') : t('chat.ver_modelos')}</button>
        <button type="button" class="gx-qc" onClick={() => go('ajustes')}>{t('dock.todos_ajustes')}</button>
      </div>
      {lst?.err && <p class="gx-kerr" role="status">{lst.err.kind === 'aborted' ? t('chat.err_aborted') : lst.err.kind === 'model' ? t('chat.p_err_model', { modelo: lst.err.detail?.model ?? '' }) : t(`chat.p_err_${lst.err.kind}`)}{lst.err.detail && lst.err.kind !== 'aborted' ? <> <code>{techLine(lst.err.detail)}</code></> : null}</p>}
      <div class="sr-only" role="status" aria-live="polite">{live}</div>
      {adding && <AddKeySheet onClose={() => setAdding(false)} onAdded={(n) => { setStore(n); p.onChange(); }} />}
      {menu && (() => {
        const k = keys.find((x) => x.id === menu.id);
        if (!k) return null;
        return (
          <Popover anchor={menu.el} onClose={() => setMenu(null)} label={t('dock.modelo_de', { alias: k.alias })} class="gx-menu">
            {optionsOf(k.provider).map((id) => <button type="button" role="menuitemradio" aria-checked={id === modelOf(k.provider)} class="gx-mi" key={id} onClick={() => setModel(k.provider, id)}><code>{id}</code></button>)}
          </Popover>
        );
      })()}
    </>
  );
}
