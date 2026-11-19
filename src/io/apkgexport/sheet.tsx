/**
 * Hoja «Exportar Anki» (Fase 4). Se carga con `import()` al abrirla; el Worker (sql.js) nace al preparar.
 * Solo lee la bóveda (mazos, medios, historial); nunca escribe. Preparar → entregar: el Blob queda en el
 * estado y «Guardar / Compartir» llama a `deliver` dentro del toque.
 */
import { errMsg, t, tn } from '../../i18n';
import { Download } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { parseDeck } from '../../cards/parse';
import { resolveMedia } from '../../data/ops';
import { safeSegment } from '../../notes/model';
import { useApp } from '../../state';
import { Sheet } from '../../ui/kit';
import { readTextOr } from '../../vault/util';
import { LIMITS } from '../limits';
import { deliver, stamp } from '../share';
import { deckNameOf, mapDeck, type MapResult } from './map';
import { buildSched, cardIdMapOf } from './sched';
import { crtOf, type BuildStats } from './write';
import type { ExportRequest } from './worker';

const WEIGHT = { notes: [0, 60], media: [60, 85], zip: [85, 100] } as const;

export function ExportAnkiSheet(props: { onClose: () => void }) {
  const app = useApp();
  const decks = app.col?.decks ?? [];
  const [sel, setSel] = useState<Set<string>>(() => new Set(decks.filter((d) => d.cards.length).map((d) => d.path)));
  const [history, setHistory] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stats, setStats] = useState<BuildStats | null>(null);
  const [err, setErr] = useState('');
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const usable = decks.filter((d) => d.cards.length);
  const busy = pct !== null;
  const reset = () => { setFile(null); setStats(null); setErr(''); };
  const toggle = (p: string) => { reset(); setSel((s) => { const x = new Set(s); x.has(p) ? x.delete(p) : x.add(p); return x; }); };
  const all = usable.length > 0 && usable.every((d) => sel.has(d.path));
  const total = decks.filter((d) => sel.has(d.path)).reduce((n, d) => n + d.cards.length, 0);

  const prepare = async () => {
    const col = app.col;
    if (!col || busy) return;
    reset();
    setPct(0);
    try {
      const picked = col.decks.filter((d) => sel.has(d.path));
      const used = new Set<number>();
      const mapped: MapResult[] = [];
      for (const d of picked) {
        await new Promise<void>((r) => setTimeout(r, 0)); // cede el hilo entre mazos
        mapped.push(mapDeck(deckNameOf(d.path), parseDeck(await readTextOr(app.vault, d.path, '')), { used }));
      }
      const media = new Map<string, Uint8Array>();
      let bytes = 0;
      for (const m of mapped) for (const orig of m.media.keys()) {
        if (media.has(orig)) continue;
        const p = await resolveMedia(app.vault, orig);
        if (!p || !p.startsWith('media/') || p.includes('..')) continue; // solo medios de la bóveda
        const b = await app.vault.read(p);
        // tope antes de acumular en memoria (el Worker vuelve a comprobarlo)
        if (b.length > LIMITS.maxApkgEntryBytes || (bytes += b.length) > LIMITS.maxApkgTotalBytes) throw Object.assign(new Error('too big'), { code: 'apkg_export_too_big' });
        media.set(orig, b);
      }
      const req: ExportRequest = { decks: mapped, media };
      if (history) {
        const { sched, revlog } = buildSched(col, cardIdMapOf(mapped), crtOf(Date.now()));
        req.sched = sched;
        req.revlog = revlog;
      }
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      const r = await new Promise<{ bytes: Uint8Array; stats: BuildStats }>((res, rej) => {
        w.onmessage = (e: MessageEvent<{ progress?: { phase: keyof typeof WEIGHT; done: number; total: number }; ok?: boolean; result?: { bytes: Uint8Array; stats: BuildStats }; error?: string; code?: string }>) => {
          const m = e.data;
          if (m.progress) {
            const [a, b] = WEIGHT[m.progress.phase];
            setPct(Math.round(a + (b - a) * (m.progress.total ? m.progress.done / m.progress.total : 1)));
          } else if (m.ok) res(m.result!);
          else rej(Object.assign(new Error(m.error), { code: m.code }));
        };
        w.onerror = (e) => rej(new Error(e.message));
        w.postMessage(req, [...media.values()].map((b) => b.buffer as ArrayBuffer));
      });
      const label = picked.length === 1 ? safeSegment(picked[0]!.name) || 'mazo' : all ? 'todos' : 'mazos';
      setFile(new File([r.bytes as BlobPart], `Engrama-${label}-${stamp().slice(0, 10)}.apkg`, { type: 'application/octet-stream' }));
      setStats(r.stats);
    } catch (e) {
      setErr((e as { code?: string }).code === 'apkg_export_too_big' ? t('apkgexport.demasiado_grande') : t('apkgexport.error', { msg: errMsg(e) }));
    }
    worker.current?.terminate();
    worker.current = null;
    setPct(null);
  };

  const conv = stats ? Object.values(stats.converted).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const parts = stats && [
    tn('apkgexport.mazos', stats.decks), tn('apkgexport.tarjetas', stats.cards), tn('apkgexport.imagenes', stats.media), tn('apkgexport.repasos', stats.revlog),
    ...(conv ? [tn('apkgexport.convertidas', conv)] : []),
    ...(stats.skipped ? [tn('apkgexport.omitidas', stats.skipped)] : []),
    ...(stats.missingMedia ? [tn('apkgexport.medios_faltantes', stats.missingMedia)] : []),
  ];

  return (
    <Sheet title={t('decks.exportar_anki')} onClose={props.onClose}>
      <div class="stack">
        <p class="t2" style={{ margin: 0 }}>{t('apkgexport.intro')}</p>
        {usable.length > 1 && (
          <label class="row" style={{ minHeight: '44px', gap: '10px' }}>
            <input type="checkbox" checked={all} disabled={busy} onChange={() => { reset(); setSel(all ? new Set() : new Set(usable.map((d) => d.path))); }} />
            <b>{t('apkgexport.todos')}</b>
          </label>
        )}
        <ul class="plan-list" aria-label={t('apkgexport.mazos_a_exportar')}>
          {decks.map((d) => (
            <li key={d.path}>
              <label class="row" style={{ flex: 1, gap: '10px', minHeight: '44px' }}>
                <input type="checkbox" checked={sel.has(d.path)} disabled={busy || !d.cards.length} onChange={() => toggle(d.path)} />
                <span data-user-content style={{ flex: 1 }}>{d.full}</span>
                <span class="t2">{d.cards.length ? tn('apkgexport.tarjetas', d.cards.length) : t('apkgexport.vacio')}</span>
              </label>
            </li>
          ))}
        </ul>
        <label class="row" style={{ minHeight: '44px', gap: '10px' }}>
          <input type="checkbox" checked={history} disabled={busy} onChange={(e) => { reset(); setHistory((e.target as HTMLInputElement).checked); }} />
          {t('apkgexport.incluir_historial')}
        </label>
        {busy && (
          <div class="stack" style={{ gap: '6px' }}>
            <div class="mini-amb-prog" role="progressbar" aria-label={t('apkgexport.preparando')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}><i style={{ width: `${pct}%` }} /></div>
            <span class="t2" aria-live="polite">{t('apkgexport.preparando')} {pct}%</span>
          </div>
        )}
        {err && <p role="alert" class="import-fail" style={{ margin: 0 }}>{err}</p>}
        {file && stats && <p class="import-sum" role="status" style={{ margin: 0 }}><b>{parts!.join(' · ')}</b></p>}
        {file ? (
          <button type="button" class="btn primary" onClick={async () => { const r = await deliver(file); if (r !== 'cancelled') app.toast(t('apkgexport.listo')); }}><Download size={18} />{' '}{t('apkgexport.guardar_compartir')}</button>
        ) : (
          <button type="button" class="btn primary" disabled={busy || sel.size === 0 || total === 0} onClick={prepare}>{t('apkgexport.preparar')}</button>
        )}
      </div>
    </Sheet>
  );
}
