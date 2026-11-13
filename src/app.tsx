import { t, deviceLang, getLang, setLang } from './i18n';
import { perf } from './lib/perf';
import { PerfHud } from './ui/perfhud';
import { Archive, Ellipsis, Inbox, Pause, Play, Plus, RefreshCw, Search, ShieldAlert, TriangleAlert } from 'lucide-preact';
import { Popover } from './ui/overlay';
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
import { BackgroundLayer, guard, sampleBackground, toneSign } from './ui/background';
import { checkIntegrity, type IntegrityReport } from './vault/integrity';
import { type OpenedVault, reconnectFolder } from './vault/open';
import { onUpdateReady } from './sw-register';
import { usePomodoro } from './screens/pomodoro';
import { walk } from './vault/util';
import { TooltipLayer } from './ui/tooltip';
import { autoPurge } from './data/decktrash';
import { autoPurgeBanks } from './sim/banktrash';
import { FRAMING_PATH, normFraming, parseFramings } from './lib/framing';
import { readTextOr } from './vault/util';
import { PhoneTabBar } from './ui/phonebar';
import { usePhone } from './ui/kit';
import { Avatar, useProfile } from './screens/profile';
import { addonOn } from './screens/addons';
import { AmbientController, AmbientPlayer, MiniAmbient } from './screens/ambient';
import { Headphones } from 'lucide-preact';
import { Sheet } from './ui/kit';
import { GlobalKeys, keymap, ShortcutSheet } from './ui/keys';
import { setPhotoQuality } from './notes/images';

const DAY = 86_400_000;

export function App(props: { opened: OpenedVault; initialSettings: Settings; hasData: boolean }) {
  const { vault } = props.opened;
  const [settings, setSettings] = useState(props.initialSettings);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const [col, setCol] = useState<Collection | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [toastAct, setToastAct] = useState<{ label: string; run: () => void } | null>(null);
  const [sheet, setSheet] = useState<AppCtx['sheet']>(null);
  const [sheetArg, setSheetArg] = useState<string | null>(null);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [hasData, setHasData] = useState(props.hasData);
  const [inboxCount, setInbox] = useState(0);
  const [preview, setPreview] = useState<{ bg: Settings['bg']; mode: 'dark' | 'light' | null } | null>(null);
  const route = useRoute();
  const [framings, setFramings] = useState<ReturnType<typeof parseFramings>>({});
  useEffect(() => { readTextOr(vault, FRAMING_PATH, '{}').then((t) => setFramings(parseFramings(t)), () => {}); }, [version]);
  const phone = usePhone();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saver = useMemo(() => createAutosave((s: Settings) => vault.write(SETTINGS_PATH, serializeSettings(s))), [vault]);

  const toast = (msg: string, action?: { label: string; run: () => void }) => {
    setToast(msg);
    setToastAct(action ?? null);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => (setToast(null), setToastAct(null)), action ? 8000 : 3400);
  };

  // idioma: se aplica antes de pintar; la colección se reprocesa para traducir sus avisos
  const langNow = settings.lang || deviceLang();
  if (getLang() !== langNow) setLang(langNow);
  setPhotoQuality(settings.photoQuality);
  const firstLang = useRef(langNow);
  useEffect(() => {
    if (firstLang.current !== langNow) (firstLang.current = langNow, setVersion((v) => v + 1));
  }, [langNow]);

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
      if (c.idsAdded) toast(t('app.se_anadieron_idsadded_ids_de_tarjeta', { idsAdded: c.idsAdded }));
    }, (e) => console.error(e));
    if (addonOn(settings, 'inbox')) walk(vault, 'inbox').then((f) => alive && setInbox(new Set(f.map((x) => x.path.split('/')[1])).size));
    else setInbox(0);
    return () => {
      alive = false;
    };
  }, [version, paramsKey, addonOn(settings, 'inbox')]);

  const recheckIntegrity = async () => setIntegrity(await checkIntegrity(vault));
  useEffect(() => {
    void recheckIntegrity();
    // papelera de mazos: vaciado automático a los N días (Ajustes → Mazos → Papelera)
    autoPurge(vault, settings.deckTrashDays).then((n) => n && setVersion((v) => v + 1), () => {});
    autoPurgeBanks(vault, settings.deckTrashDays).then((n) => n && setVersion((v) => v + 1), () => {}); // bancos: mismos días
    onUpdateReady((apply) => setUpdate(() => apply));
    // sugerencia discreta con acción: el usuario decide (nunca se activa solo)
    watchFrames(() => !ctxRef.current.settings.lightMode && toast(t('app.el_vidrio_va_lento_en_este'), { label: t('app.activar_modo_ligero'), run: () => ctxRef.current.update({ lightMode: true }) }));
  }, []);
  useEffect(() => {
    if (version > 0) (void recheckIntegrity(), setHasData(true));
  }, [version]);

  // guardián de legibilidad
  const sample = useRef<ImageData | null>(null);
  const lastBg = useRef('');
  const toastedFor = useRef('');
  const framing = eff.bg.kind === 'image' ? normFraming(framings[eff.bg.value]) : undefined;
  const bgKey = JSON.stringify([eff.bg, eff.bgDim, eff.glassMode, framing]);
  // el guardián siempre lee el estado vigente (evita cierres obsoletos en temporizadores)
  const effRef = useRef(eff);
  effRef.current = eff;
  const runGuard = () => {
    if (!sample.current) return;
    const cur = effRef.current;
    const r = guard(sample.current, resolvedMode(cur), cur.glass / 100);
    const sign = toneSign(sample.current);
    (window as unknown as { __guard: unknown }).__guard = { ...r, sign, key: lastBg.current, mode: resolvedMode(cur) };
    if (r.adjusted && toastedFor.current !== lastBg.current) {
      toastedFor.current = lastBg.current;
      toast(t('app.ajustamos_el_vidrio_para_que_se'));
    }
  };
  useEffect(() => {
    let alive = true;
    const resample = () =>
      sampleBackground(eff.bg, vault, settings.bgDim, innerWidth, innerHeight, framing).then((s) => {
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
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // atajos con teclado externo (configurables: Ajustes → Atajos, .app/atajos.json)
  const [keysHelp, setKeysHelp] = useState(false);
  useEffect(() => { void keymap.load(vault); }, [vault]);
  const runGlobal = (id: string) => {
    if (id === 'global.palette' || id === 'global.files') ctx.openSheet('palette', id === 'global.files' ? 'archivos' : null);
    else if (id === 'global.newNote') go('notas', '+nueva');
    else if (id === 'global.newCard') ctx.openSheet('add');
    else if (id === 'global.help') setKeysHelp(true);
    else if (id === 'global.find') document.querySelector<HTMLInputElement>('main [role="search"] input, main input[type="search"]')?.focus();
    else if (id.startsWith('global.go')) go(({ goHoy: 'hoy', goMazos: 'mazos', goNotas: 'notas', goCalendario: 'calendario', goSimulacros: 'simulacros' } as Record<string, string>)[id.slice(7)]!);
  };

  const bg = <BackgroundLayer bg={eff.bg} blur={settings.bgBlur} dim={settings.bgDim} vault={vault} framing={framing} />;

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
              <span class="k">{t('app.nueva_version_disponible')}</span>
              <button type="button" class="btn small primary" onClick={update}>{t('app.actualizar')}</button>
            </div>
          )}
          {ctx.temporary && (
            <div class="banner glass" role="alert">
              <ShieldAlert size={18} />
              <span class="k"><b>{t('app.modo_temporal')}</b>{' '}{t('app.este_navegador_no_permite_guardar_navegaci')}</span>
            </div>
          )}
          {ctx.folderNeedsPermission && (
            <div class="banner glass">
              <TriangleAlert size={18} />
              <span class="k">{t('app.la_carpeta_conectada_necesita_permiso_de')}</span>
              <button type="button" class="btn small" onClick={async () => (await reconnectFolder()) && location.reload()}>{t('app.reconectar')}</button>
            </div>
          )}
          {(rec.recovered.length > 0 || rec.discarded.length > 0 || rec.journalCorrupt) && version === 0 && (
            <div class="banner glass" role="status">
              <ShieldAlert size={18} />
              <span class="k">{t('app.se_recupero_una_escritura_interrumpida')}{rec.recovered.length ? `: ${rec.recovered.join(', ')}` : ''}
                {rec.discarded.length ? t('app.descarto_incompleta', { p: rec.discarded.join(', ') }) : ''}.
              </span>
            </div>
          )}
          {showBackup && (
            <div class="banner glass">
              <Archive size={18} />
              <span class="k">{settings.lastExportAt ? t('app.tu_ultimo_respaldo_fue_hace_p', { p: Math.floor((Date.now() - settings.lastExportAt) / DAY) }) : t('app.aun_no_tienes_un_respaldo_visible')}</span>
              <button type="button" class="btn small" onClick={() => ctx.update({ backupReminderSnoozedUntil: Date.now() + 3 * DAY })}>{t('app.luego')}</button>
              <button type="button" class="btn small primary" onClick={() => setSheet('backup')}>{t('app.respaldar')}</button>
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
      {phone && <PhoneTabBar tab={tabId} />}
      <GlobalKeys run={runGlobal} />
      {keysHelp && <ShortcutSheet onClose={() => setKeysHelp(false)} />}
      {addonOn(settings, 'ambient') && <AmbientController />}
      {addonOn(settings, 'ambient') && phone && <MiniAmbient floating />}
      {sheet === 'ambient' && <Sheet title={t('addons.n_ambient')} onClose={() => setSheet(null)}><AmbientPlayer /></Sheet>}
      {toastMsg && <div class="toast glass strong" role="status" aria-live="polite">{toastMsg}{toastAct && <>{' '}<button type="button" class="btn small toast-act" onClick={() => { const a = toastAct; setToast(null); setToastAct(null); a.run(); }}>{toastAct.label}</button></>}</div>}
      <TooltipLayer />
      <div class="dev-sign" aria-hidden="true">{t('app.desarrollador')}</div>
      {perf.on && <PerfHud />}
    </Ctx.Provider>
  );
}

function TopBar(props: { tab: string }) {
  const app = ctxHook();
  const phoneBar = usePhone();
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
  const profile = useProfile();
  const [moreAt, setMoreAt] = useState<HTMLElement | null>(null);
  const rem = p.state.running && p.state.endAt ? p.state.endAt - p.now : p.state.remaining;
  const mm = `${String(Math.floor(Math.ceil(rem / 1000) / 60)).padStart(2, '0')}:${String(Math.ceil(rem / 1000) % 60).padStart(2, '0')}`;
  return (
    <header class="topbar no-print">
      <a href="#/hoy" class="brand-mark" aria-label={t('app.engrama_ir_a_hoy')}><img src="brand/logo-64.png" width="28" height="28" alt="" /></a>
      <nav class="seg-nav glass" ref={nav} aria-label={t('app.secciones')}>
        {slider && <span class="slider" style={{ width: `${slider.w}px`, transform: `translateX(${slider.x - 4}px)`, left: '4px' }} aria-hidden="true" />}
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} aria-current={props.tab === t.id ? 'page' : undefined} aria-label={t.label} data-tip={props.tab === t.id ? undefined : t.label}>
            <t.icon size={18} aria-hidden="true" />
            <span class="lbl">{t.label}</span>
          </a>
        ))}
      </nav>
      <span class="spacer" />
      <button type="button" class="pill glass" onClick={() => app.openSheet('add')} aria-label={t('app.anadir_tarjeta')}>
        <Plus size={18} />
      </button>
      <button type="button" class="pill glass mini-pomo" onClick={() => (p.state.running ? p.pause() : p.start())} aria-label={p.state.running ? t('app.pausar_enfoque') : t('app.iniciar_enfoque')} data-tip={p.state.running ? t('app.pausar_enfoque') : t('app.iniciar_enfoque')}>
        {p.state.running ? <Pause size={16} /> : <Play size={16} />} {mm}
      </button>
      <button type="button" class="pill glass" onClick={() => app.openSheet('palette')} aria-label={t('app.buscar_k')}>
        <Search size={18} />
      </button>
      {addonOn(app.settings, 'inbox') && <a class="pill glass" href="#/bandeja" aria-label={t('app.bandeja_inboxcount_pendientes', { inboxCount: app.inboxCount })} data-tip={t('app.bandeja_inboxcount_pendientes', { inboxCount: app.inboxCount })}>
        <Inbox size={18} /> <span class={`count${app.inboxCount ? '' : ' zero'}`}>{app.inboxCount}</span>
      </a>}
      {/* Ajustes y Respaldo viven en Perfil (Prompt 6 · B). iPad (601–1100 px): Sonido ambiente pasa a «⋯» */}
      {addonOn(app.settings, 'ambient') && (
        <button type="button" class="pill glass more-pill" aria-label={t('phone.mas')} aria-haspopup="menu" aria-expanded={!!moreAt} onClick={(e) => setMoreAt(moreAt ? null : (e.currentTarget as HTMLElement))}>
          <Ellipsis size={18} />
        </button>
      )}
      {moreAt && (
        <Popover anchor={moreAt} onClose={() => setMoreAt(null)} label={t('phone.mas')} role="menu" class="glass strong add-menu">
          <button type="button" role="menuitem" onClick={() => (setMoreAt(null), app.openSheet('ambient'))}><Headphones size={18} />{' '}{t('addons.n_ambient')}</button>
        </Popover>
      )}
      {addonOn(app.settings, 'ambient') && <button type="button" class="pill glass ph-hide mid-hide" aria-label={t('addons.n_ambient')} onClick={() => app.openSheet('ambient')}><Headphones size={18} /></button>}
      {addonOn(app.settings, 'ambient') && !phoneBar && <MiniAmbient />}
      <a class="pill glass avatar-pill ph-hide" href="#/perfil" aria-label={t('profile.perfil')} aria-current={props.tab === 'perfil' || props.tab === 'ajustes' ? 'page' : undefined}>
        <Avatar profile={profile} size={32} />
      </a>
    </header>
  );
}


