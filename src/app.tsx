import { Archive, Inbox, Pause, Play, Plus, RefreshCw, Search, Settings as Gear, ShieldAlert, TriangleAlert } from 'lucide-preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { loadCollection, type Collection } from './data/collection';
import { createAutosave } from './lib/autosave';
import { backupDue, serializeSettings, SETTINGS_PATH, type Settings, srsParams } from './lib/settings';
import { TABS } from './nav';
import { BackupSheet } from './screens/backup';
import { ImportSheet } from './screens/import';
import { Screen } from './screens/router';
import { Welcome } from './screens/welcome';
import { AddCardSheet } from './screens/deck';
import { ExamSheet } from './screens/exams';
import { Palette } from './screens/palette';
import { type AppCtx, Ctx, go, useApp as ctxHook, useRoute } from './state';
import { applyTheme, onSchemeChange, resolvedMode, watchFrames } from './theme';
import { BackgroundLayer, guard, sampleBackground } from './ui/background';
import { checkIntegrity, type IntegrityReport } from './vault/integrity';
import { type OpenedVault, reconnectFolder } from './vault/open';
import { onUpdateReady } from './sw-register';
import { usePomodoro } from './screens/pomodoro';
import { walk } from './vault/util';

const DAY = 86_400_000;

export function App(props: { opened: OpenedVault; initialSettings: Settings; hasData: boolean }) {
  const { vault } = props.opened;
  const [settings, setSettings] = useState(props.initialSettings);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const [col, setCol] = useState<Collection | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<AppCtx['sheet']>(null);
  const [sheetArg, setSheetArg] = useState<string | null>(null);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [hasData, setHasData] = useState(props.hasData);
  const [inboxCount, setInbox] = useState(0);
  const [preview, setPreview] = useState<{ bg: Settings['bg']; mode: 'dark' | 'light' | null } | null>(null);
  const route = useRoute();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saver = useMemo(() => createAutosave((s: Settings) => vault.write(SETTINGS_PATH, serializeSettings(s))), [vault]);

  const toast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3400);
  };

  // tema (la vista previa puede forzar un fondo y un modo sin tocar Ajustes)
  const eff: Settings = preview ? { ...settings, bg: preview.bg, glassMode: preview.mode ?? settings.glassMode } : settings;
  useEffect(() => {
    applyTheme(eff);
    return onSchemeChange(() => applyTheme(eff));
  }, [settings, preview]);

  // colección (mazos + estado FSRS)
  const paramsKey = JSON.stringify(srsParams(settings));
  useEffect(() => {
    let alive = true;
    loadCollection(vault, srsParams(settings)).then((c) => {
      if (!alive) return;
      setCol(c);
      if (c.idsAdded) toast(`Se añadieron ${c.idsAdded} IDs de tarjeta a tus mazos`);
    }, (e) => console.error(e));
    walk(vault, 'inbox').then((f) => alive && setInbox(new Set(f.map((x) => x.path.split('/')[1])).size));
    return () => {
      alive = false;
    };
  }, [version, paramsKey]);

  const recheckIntegrity = async () => setIntegrity(await checkIntegrity(vault));
  useEffect(() => {
    void recheckIntegrity();
    onUpdateReady((apply) => setUpdate(() => apply));
    watchFrames(() => !settings.lightMode && toast('El vidrio va lento en este equipo: prueba el modo ligero en Ajustes → Apariencia'));
  }, []);
  useEffect(() => {
    if (version > 0) (void recheckIntegrity(), setHasData(true));
  }, [version]);

  // guardián de legibilidad
  const sample = useRef<ImageData | null>(null);
  const lastBg = useRef('');
  const toastedFor = useRef('');
  const bgKey = JSON.stringify([eff.bg, eff.bgDim, eff.glassMode]);
  // el guardián siempre lee el estado vigente (evita cierres obsoletos en temporizadores)
  const effRef = useRef(eff);
  effRef.current = eff;
  const runGuard = () => {
    if (!sample.current) return;
    const cur = effRef.current;
    const r = guard(sample.current, resolvedMode(cur), cur.glass / 100);
    (window as unknown as { __guard: unknown }).__guard = { ...r, key: lastBg.current, mode: resolvedMode(cur) };
    if (r.adjusted && toastedFor.current !== lastBg.current) {
      toastedFor.current = lastBg.current;
      toast('Ajustamos el vidrio para que se lea mejor');
    }
  };
  useEffect(() => {
    let alive = true;
    const resample = () =>
      sampleBackground(eff.bg, vault, settings.bgDim, innerWidth, innerHeight).then((s) => {
        if (!alive) return;
        sample.current = s;
        lastBg.current = bgKey;
        requestAnimationFrame(runGuard);
      }, () => {});
    void resample();
    let t: ReturnType<typeof setTimeout>;
    const later = () => (clearTimeout(t), (t = setTimeout(runGuard, 180)));
    const onResize = () => (clearTimeout(t), (t = setTimeout(resample, 250)));
    const mo = new MutationObserver(later);
    mo.observe(document.getElementById('app')!, { childList: true, subtree: true });
    addEventListener('resize', onResize);
    addEventListener('scroll', later, { passive: true, capture: true });
    return () => {
      alive = false;
      clearTimeout(t);
      mo.disconnect();
      removeEventListener('resize', onResize);
      removeEventListener('scroll', later, { capture: true } as EventListenerOptions);
    };
  }, [bgKey, settings.glass]);

  const pomo = usePomodoro(vault, settings, toast, () => setVersion((v) => v + 1));

  const ctx: AppCtx = {
    vault,
    detail: props.opened.detail,
    temporary: vault.kind === 'memory',
    folderNeedsPermission: props.opened.folderNeedsPermission,
    recovery: props.opened.recovery,
    integrity,
    recheckIntegrity,
    settings,
    update(patch, immediate) {
      setSettings((s) => {
        const next = { ...s, ...patch };
        saver.schedule(next);
        if (immediate) void saver.flush();
        return next;
      });
    },
    replaceSettings(next) {
      setSettings(next);
      saver.schedule(next);
      void saver.flush();
    },
    version,
    changed: () => setVersion((v) => v + 1),
    tick,
    refresh: () => setTick((t) => t + 1),
    col,
    toast,
    sheet,
    sheetArg,
    openSheet: (s, arg = null) => (setSheetArg(arg), setSheet(s)),
    pomo,
    inboxCount,
    focus: (on) => document.body.classList.toggle('focus', on),
    previewBg: (bg, mode = null) => setPreview(bg ? { bg, mode } : null),
  };

  // atajos con teclado externo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'k' || k === 'p' || k === 'o') (e.preventDefault(), ctx.openSheet('palette', k === 'o' ? 'archivos' : null));
      else if (k === 'n' && !e.shiftKey) (e.preventDefault(), go('notas', '+nueva'));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const bg = <BackgroundLayer bg={eff.bg} blur={settings.bgBlur} dim={settings.bgDim} vault={vault} />;

  if (!settings.welcomeDone) {
    return (
      <Ctx.Provider value={ctx}>
        {bg}
        <div class="app">
          <Welcome />
        </div>
        {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
        {toastMsg && <div class="toast glass strong" role="status">{toastMsg}</div>}
      </Ctx.Provider>
    );
  }

  const rec = props.opened.recovery;
  const showBackup = !ctx.temporary && backupDue(settings, Date.now(), hasData) && route[0] === 'hoy';
  const tabId = route[0] ?? 'hoy';

  return (
    <Ctx.Provider value={ctx}>
      {bg}
      <div class="app">
        <TopBar tab={tabId} />
        <main class="page" id="main">
          {update && (
            <div class="banner glass" role="status">
              <RefreshCw size={18} />
              <span class="k">Nueva versión disponible.</span>
              <button type="button" class="btn small primary" onClick={update}>Actualizar</button>
            </div>
          )}
          {ctx.temporary && (
            <div class="banner glass" role="alert">
              <ShieldAlert size={18} />
              <span class="k"><b>Modo temporal.</b> Este navegador no permite guardar (¿navegación privada?). Exporta antes de cerrar.</span>
            </div>
          )}
          {ctx.folderNeedsPermission && (
            <div class="banner glass">
              <TriangleAlert size={18} />
              <span class="k">La carpeta conectada necesita permiso de nuevo. Mientras tanto se usa el almacenamiento privado.</span>
              <button type="button" class="btn small" onClick={async () => (await reconnectFolder()) && location.reload()}>Reconectar</button>
            </div>
          )}
          {(rec.recovered.length > 0 || rec.discarded.length > 0 || rec.journalCorrupt) && version === 0 && (
            <div class="banner glass" role="status">
              <ShieldAlert size={18} />
              <span class="k">
                Se recuperó una escritura interrumpida{rec.recovered.length ? `: ${rec.recovered.join(', ')}` : ''}
                {rec.discarded.length ? `. Se descartó una incompleta en ${rec.discarded.join(', ')} (el archivo anterior quedó intacto)` : ''}.
              </span>
            </div>
          )}
          {showBackup && (
            <div class="banner glass">
              <Archive size={18} />
              <span class="k">{settings.lastExportAt ? `Tu último respaldo fue hace ${Math.floor((Date.now() - settings.lastExportAt) / DAY)} días.` : 'Aún no tienes un respaldo visible en Archivos.'}</span>
              <button type="button" class="btn small" onClick={() => ctx.update({ backupReminderSnoozedUntil: Date.now() + 3 * DAY })}>Luego</button>
              <button type="button" class="btn small primary" onClick={() => setSheet('backup')}>Respaldar</button>
            </div>
          )}
          <Screen route={route} />
        </main>
      </div>
      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
      {sheet === 'backup' && <BackupSheet onClose={() => setSheet(null)} />}
      {sheet === 'add' && <AddCardSheet deckPath={sheetArg} onClose={() => setSheet(null)} />}
      {sheet === 'exam' && <ExamSheet path={sheetArg} onClose={() => setSheet(null)} />}
      {sheet === 'palette' && <Palette mode={sheetArg} onClose={() => setSheet(null)} />}
      {toastMsg && <div class="toast glass strong" role="status" aria-live="polite">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

function TopBar(props: { tab: string }) {
  const app = ctxHook();
  const nav = useRef<HTMLElement>(null);
  const [slider, setSlider] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const a = nav.current?.querySelector<HTMLElement>('a[aria-current="page"]');
      setSlider(a ? { x: a.offsetLeft, w: a.offsetWidth } : null);
    };
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [props.tab]);
  const p = app.pomo;
  const rem = p.state.running && p.state.endAt ? p.state.endAt - p.now : p.state.remaining;
  const mm = `${String(Math.floor(Math.ceil(rem / 1000) / 60)).padStart(2, '0')}:${String(Math.ceil(rem / 1000) % 60).padStart(2, '0')}`;
  return (
    <header class="topbar no-print">
      <nav class="seg-nav glass" ref={nav} aria-label="Secciones">
        {slider && <span class="slider" style={{ width: `${slider.w}px`, transform: `translateX(${slider.x - 4}px)`, left: '4px' }} aria-hidden="true" />}
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} aria-current={props.tab === t.id ? 'page' : undefined} aria-label={t.label} title={t.label}>
            <t.icon size={18} aria-hidden="true" />
            <span class="lbl">{t.label}</span>
          </a>
        ))}
      </nav>
      <span class="spacer" />
      <button type="button" class="pill glass" onClick={() => app.openSheet('add')} aria-label="Añadir tarjeta" title="Añadir tarjeta">
        <Plus size={18} />
      </button>
      <button type="button" class="pill glass mini-pomo" onClick={() => (p.state.running ? p.pause() : p.start())} aria-label={p.state.running ? 'Pausar enfoque' : 'Iniciar enfoque'} title="Pomodoro">
        {p.state.running ? <Pause size={16} /> : <Play size={16} />} {mm}
      </button>
      <button type="button" class="pill glass" onClick={() => app.openSheet('palette')} aria-label="Buscar (⌘K)" title="Buscar (⌘K)">
        <Search size={18} />
      </button>
      <a class="pill glass" href="#/bandeja" aria-label={`Bandeja: ${app.inboxCount} pendientes`} title="Bandeja">
        <Inbox size={18} /> <span class={`count${app.inboxCount ? '' : ' zero'}`}>{app.inboxCount}</span>
      </a>
      <button type="button" class="pill glass" onClick={() => app.openSheet('backup')} aria-label="Respaldo" title="Respaldo">
        <Archive size={18} />
      </button>
      <a class="pill glass" href="#/ajustes" aria-label="Ajustes" title="Ajustes" aria-current={props.tab === 'ajustes' ? 'page' : undefined}>
        <Gear size={18} />
      </a>
    </header>
  );
}


