import { locale, t } from '../i18n';
import { Archive, Eraser, Trash2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { formatBytes, storageInfo } from '../lib/storage';
import { countUses, DELETABLE, KINDS, kindOf, orphans, REGENERABLE, type Kind } from '../lib/usage';
import { useApp, useAsync } from '../state';
import { forgetMediaUrl } from '../ui/background';
import { Bar, Sheet } from '../ui/kit';
import { readTextOr, walk } from '../vault/util';

/** Documentos que pueden citar archivos: notas, mazos, bancos, bandeja, plantillas y espacios. */
const CITES = (p: string) => /^(decks|notes|exams-bank|exams|inbox|templates)\//.test(p) && p.endsWith('.md') || (p.startsWith('.app/spaces/') && p.endsWith('.json'));

const KIND_LABEL = (): Record<Kind, string> => ({
  pdf: 'PDF', documentos: t('storage.documentos'), hojas: t('storage.hojas'), fotos: t('storage.fotos'), fondos: t('storage.fondos'),
  audio: t('storage.audio'), cache: t('storage.cache'), datos: t('storage.datos'), otros: t('storage.otros'),
});

/**
 * Ajustes → Almacenamiento (C10): uso total, desglose por tipo, lista por tamaño con
 * selección múltiple, «Usado en N lugares», huérfanos y cachés regenerables.
 * Borrar es definitivo (con confirmación); las notas que citaban el archivo muestran
 * «Archivo eliminado» en su lugar.
 */
export function StorageSheet(props: { onClose: () => void }) {
  const app = useApp();
  const [tick, setTick] = useState(0);
  const { data: info } = useAsync(storageInfo, [tick]);
  const { data } = useAsync(async () => {
    const all = await walk(app.vault, '');
    const docs = await Promise.all(all.filter((f) => CITES(f.path)).map(async (f) => ({ path: f.path, text: await readTextOr(app.vault, f.path, '') })));
    const files = all.filter((f) => DELETABLE(f.path));
    return { all, files, uses: countUses(files.map((f) => f.path), docs) };
  }, [tick, app.version]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<'size' | 'name'>('size');
  const byKind = useMemo(() => {
    const m = new Map<Kind, number>(KINDS.map((k) => [k, 0]));
    for (const f of data?.all ?? []) m.set(kindOf(f.path), m.get(kindOf(f.path))! + f.size);
    return m;
  }, [data]);
  const total = [...byKind.values()].reduce((a, b) => a + b, 0);
  const list = [...(data?.files ?? [])].sort((a, b) => (sort === 'size' ? b.size - a.size : a.path.localeCompare(b.path, locale())));
  const orph = data ? orphans(data.uses) : [];
  const cacheBytes = (data?.all ?? []).filter((f) => REGENERABLE(f.path)).reduce((n, f) => n + f.size, 0);
  const toggle = (p: string) => setSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const selBytes = list.filter((f) => sel.has(f.path)).reduce((n, f) => n + f.size, 0);

  const remove = async () => {
    const paths = [...sel];
    const used = paths.reduce((n, p) => n + (data?.uses.get(p)?.length ?? 0), 0);
    const msg = t('storage.confirmar_borrar', { n: paths.length, size: formatBytes(selBytes) }) + (used ? '\n\n' + t('storage.confirmar_usados', { n: used }) : '');
    if (!confirm(msg)) return;
    for (const p of paths) (await app.vault.remove(p), forgetMediaUrl(p));
    setSel(new Set());
    setTick((n) => n + 1);
    app.changed();
    app.toast(t('storage.liberados', { size: formatBytes(selBytes) }));
  };

  return (
    <Sheet title={t('storage.almacenamiento')} onClose={props.onClose} wide>
      <div class="stack">
        <div class="row wrap">
          <div class="grow">
            <div class="big" style={{ fontSize: 'var(--t-1)' }}>{formatBytes(total)}</div>
            <div class="foot">{t('storage.en_tu_boveda')} · {t('settings.usado_de', { used: formatBytes(info?.usage ?? null), quota: formatBytes(info?.quota ?? null) })}</div>
          </div>
          <button type="button" class="btn" onClick={() => app.openSheet('backup')}><Archive size={16} />{' '}{t('storage.respaldar_antes')}</button>
        </div>
        <p class="foot">{t('storage.sugerencia_exportar')}</p>

        <div class="stack-s" role="list" aria-label={t('storage.por_tipo')}>
          {KINDS.filter((k) => byKind.get(k)).map((k) => (
            <div role="listitem" class="stack-s">
              <div class="kv"><span class="k">{KIND_LABEL()[k]}</span><span class="v">{formatBytes(byKind.get(k)!)}</span></div>
              <Bar value={total ? byKind.get(k)! / total : 0} label={KIND_LABEL()[k]} />
            </div>
          ))}
        </div>

        <div class="row wrap">
          <button type="button" class="btn small" disabled={!orph.length} onClick={() => setSel(new Set(orph))}>{t('storage.seleccionar_huerfanos', { n: orph.length })}</button>
          <button type="button" class="btn small" disabled={!cacheBytes} onClick={async () => {
            for (const f of data!.all.filter((x) => REGENERABLE(x.path))) await app.vault.remove(f.path);
            setTick((n) => n + 1);
            app.changed(); // la colección reconstruye state.json desde reviews.jsonl
            app.toast(t('storage.cache_vaciada', { size: formatBytes(cacheBytes) }));
          }}><Eraser size={14} />{' '}{t('storage.vaciar_caches', { size: formatBytes(cacheBytes) })}</button>
          <span class="grow" />
          <label class="foot row">{t('storage.ordenar')}
            <select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as 'size' | 'name')}>
              <option value="size">{t('storage.por_tamano')}</option><option value="name">{t('storage.por_nombre')}</option>
            </select>
          </label>
        </div>

        {!list.length && <p class="t2">{t('storage.sin_archivos_pesados')}</p>}
        <div class="group inset storage-list">
          {list.map((f) => {
            const uses = data!.uses.get(f.path) ?? [];
            return (
              <label class="row-i tap">
                <input type="checkbox" checked={sel.has(f.path)} onChange={() => toggle(f.path)} aria-label={t('storage.seleccionar_x', { name: f.path })} />
                <span class="k"><span class="ellipsis" style={{ display: 'block' }} data-user-content>{f.path.replace(/^(media|docs)\//, '')}</span>
                  <small data-tip={uses.length ? uses.join('\n') : undefined}>{KIND_LABEL()[kindOf(f.path)]} · {uses.length ? t('storage.usado_en_n', { n: uses.length }) : f.path.startsWith('media/') ? t('storage.huerfano') : t('storage.sin_enlaces')}</small>
                </span>
                <span class="v num">{formatBytes(f.size)}</span>
              </label>
            );
          })}
        </div>
        <div class="row wrap storage-actions">
          <span class="foot grow">{sel.size ? t('storage.n_seleccionados', { n: sel.size, size: formatBytes(selBytes) }) : ''}</span>
          <button type="button" class="btn danger" disabled={!sel.size} onClick={() => void remove()}><Trash2 size={16} />{' '}{t('storage.borrar_definitivamente')}</button>
        </div>
      </div>
    </Sheet>
  );
}
