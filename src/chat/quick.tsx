import { Check, Plus, SlidersHorizontal, SquarePen, X, Zap } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { t } from '../i18n';
import { cleanAction, MAX_ACTIONS } from '../lib/settings';
import { useApp } from '../state';
import { KeyView } from './keyview';

/** De fábrica, en el idioma de la interfaz; las que edita el usuario se guardan tal cual (no se traducen). */
export const defaultActions = () => [t('dock.a1'), t('dock.a2'), t('dock.a3'), t('dock.a4')];
export const useActions = (): string[] => useApp().settings.chat.acciones ?? defaultActions();
export const MARK = /\[[^\]]+\]/;

/** Texto con las partes [editables] en gris. */
function Marked(p: { text: string }) {
  const out: ComponentChildren[] = [];
  p.text.split(/(\[[^\]]+\])/).forEach((s, i) => { if (s) out.push(i % 2 ? <em key={i}>{s}</em> : s); });
  return <>{out}</>;
}

/** Pestaña «Acciones rápidas» sobre la pastilla (la muestra el CSS con el cursor, el foco o ⚡). Rellena el campo del chat, nunca envía. */
export function Quick(p: { onPick: (text: string) => void; editing: boolean; onEdit: (on: boolean) => void; mode: 'acc' | 'mod'; onMode: (m: 'acc' | 'mod') => void; onChange: () => void }) {
  const app = useApp();
  const list = useActions();
  const save = (next: string[]) => app.update({ chat: { ...app.settings.chat, acciones: next.slice(0, MAX_ACTIONS) } });
  const commit = (i: number, raw: string) => {
    const v = cleanAction(raw);
    save(v ? list.map((a, k) => (k === i ? v : a)) : list.filter((_, k) => k !== i)); // vacío = quitar
  };
  if (p.mode === 'mod') return <div class="gx-quick glass" role="group" aria-label={t('dock.modelo_claves')} id="gx-quick"><KeyView onBack={() => p.onMode('acc')} onChange={p.onChange} /></div>;
  return (
    <div class="gx-quick glass" role="group" aria-label={t('dock.rapidas')} id="gx-quick">
      <div class="gx-qh">
        <span><Zap size={13} aria-hidden="true" /> {t('dock.rapidas')}</span>
        <button type="button" class="gx-ib" aria-label={t('dock.modelo_claves')} onClick={() => p.onMode('mod')}><SlidersHorizontal size={18} aria-hidden="true" /></button>
        <button type="button" class="gx-ib" aria-label={p.editing ? t('dock.listo') : t('dock.editar')} aria-pressed={p.editing} onClick={() => p.onEdit(!p.editing)}>{p.editing ? <Check size={16} aria-hidden="true" /> : <SquarePen size={16} aria-hidden="true" />}</button>
      </div>
      <div class="gx-qs">
        {list.map((a, i) => p.editing
          ? (
            <div class="gx-qc edit" key={`${i}:${a}`}>
              <span contentEditable aria-label={t('dock.editar_una')} role="textbox" data-user-content
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                onBlur={(e) => { const v = (e.currentTarget as HTMLElement).textContent ?? ''; if (v !== a) commit(i, v); }}>{a}</span>
              <button type="button" class="gx-qx" aria-label={t('dock.quitar')} onClick={() => save(list.filter((_, k) => k !== i))}><X size={14} aria-hidden="true" /></button>
            </div>
          )
          : <button type="button" class="gx-qc" key={`${i}:${a}`} onClick={() => p.onPick(a)}><span data-user-content><Marked text={a} /></span></button>)}
        {p.editing && list.length < MAX_ACTIONS && <button type="button" class="gx-qc add" onClick={() => save([...list, t('dock.a_nueva')])}><Plus size={14} aria-hidden="true" /> {t('dock.anadir')}</button>}
      </div>
    </div>
  );
}
