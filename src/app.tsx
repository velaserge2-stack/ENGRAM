import { AlertTriangle, Archive, Download, MoreHorizontal, RefreshCw, ShieldAlert } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createAutosave } from './lib/autosave';
import { backupDue, serializeSettings, SETTINGS_PATH, type Settings } from './lib/settings';
import { TABS, type TabId } from './nav';
import { BackupSheet } from './screens/backup';
import { DeckView, Decks } from './screens/decks';
import { ImportSheet } from './screens/import';
import { Placeholder } from './screens/placeholder';
import { SettingsScreen } from './screens/settings';
import { Today } from './screens/today';
import { Welcome } from './screens/welcome';
import { type AppCtx, Ctx, go, useRoute } from './state';
import { applyTheme, onSchemeChange } from './theme';
import { checkIntegrity, type IntegrityReport } from './vault/integrity';
import type { OpenedVault } from './vault/open';
import { reconnectFolder } from './vault/open';
import { Sheet } from './ui/kit';
import { onUpdateReady } from './sw-register';

const DAY = 86_400_000;

export function App(props: { opened: OpenedVault; initialSettings: Settings; hasData: boolean }) {
  const { vault } = props.opened;
  const [settings, setSettings] = useState(props.initialSettings);
  const [version, setVersion] = useState(0);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<AppCtx['sheet']>(null);
  const [more, setMore] = useState(false);
  const [update, setUpdate] = useState<(() => void) | null>(null);
  const [hasData, setHasData] = useState(props.hasData);
  const route = useRoute();
  const tab = (TABS.some((t) => t.id === route[0]) ? route[0] : 'hoy') as TabId;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saver = useMemo(() => createAutosave((s: Settings) => vault.write(SETTINGS_PATH, serializeSettings(s))), [vault]);

  useEffect(() => {
    applyTheme(settings);
    return onSchemeChange(() => applyTheme(settings));
  }, [settings]);

  const recheckIntegrity = async () => setIntegrity(await checkIntegrity(vault));
  useEffect(() => {
    void recheckIntegrity();
    onUpdateReady((apply) => setUpdate(() => apply));
  }, []);
  useEffect(() => {
    if (version > 0) {
      void recheckIntegrity();
      setHasData(true);
    }
  }, [version]);

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
    toast(msg) {
      setToast(msg);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3200);
    },
    sheet,
    openSheet: setSheet,
  };

  if (!settings.welcomeDone) {
    return (
      <Ctx.Provider value={ctx}>
        <div class="backdrop" />
        <Welcome />
        {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
      </Ctx.Provider>
    );
  }

  const rec = props.opened.recovery;
  const showBackup = !ctx.temporary && backupDue(settings, Date.now(), hasData);

  return (
    <Ctx.Provider value={ctx}>
      <div class="backdrop" />
      <div class="app">
        <nav class="sidebar glass" aria-label="Secciones">
          <div class="brand">
            <img src="icons/icon-192.png" alt="" />
            Engrama
          </div>
          {TABS.map((t) => (
            <a key={t.id} class="nav-item" href={`#/${t.id}`} aria-current={tab === t.id ? 'page' : undefined}>
              <t.icon size={20} aria-hidden="true" />
              {t.label}
              {t.phase > 1 && <span class="badge">pronto</span>}
            </a>
          ))}
          <div class="grow" />
          <button type="button" class="nav-item" onClick={() => setSheet('backup')}>
            <Archive size={20} aria-hidden="true" /> Respaldo
          </button>
        </nav>

        <main class="content" id="main">
          <div class="page" style={{ paddingTop: '12px' }}>
            {update && (
              <div class="banner glass" role="status">
                <RefreshCw size={18} />
                <span class="k">Nueva versión disponible.</span>
                <button type="button" class="btn small primary" onClick={update}>Actualizar</button>
              </div>
            )}
            {ctx.temporary && (
              <div class="banner glass warn" role="alert">
                <ShieldAlert size={18} />
                <span class="k"><b>Modo temporal.</b> Este navegador no permite guardar (¿navegación privada?). Exporta antes de cerrar.</span>
              </div>
            )}
            {ctx.folderNeedsPermission && (
              <div class="banner glass warn">
                <AlertTriangle size={18} />
                <span class="k">La carpeta conectada necesita permiso de nuevo. Mientras tanto se usa el almacenamiento privado.</span>
                <button type="button" class="btn small" onClick={async () => (await reconnectFolder()) && location.reload()}>Reconectar</button>
              </div>
            )}
            {(rec.recovered.length > 0 || rec.discarded.length > 0 || rec.journalCorrupt) && version === 0 && (
              <div class="banner glass" role="status">
                <ShieldAlert size={18} />
                <span class="k">
                  Se recuperó una escritura interrumpida
                  {rec.recovered.length ? `: ${rec.recovered.join(', ')}` : ''}
                  {rec.discarded.length ? `. Se descartó una incompleta en ${rec.discarded.join(', ')} (el archivo anterior quedó intacto)` : ''}.
                </span>
              </div>
            )}
            {showBackup && tab === 'hoy' && (
              <div class="banner glass">
                <Download size={18} />
                <span class="k">
                  {settings.lastExportAt ? `Tu último respaldo fue hace ${Math.floor((Date.now() - settings.lastExportAt) / DAY)} días.` : 'Aún no tienes un respaldo visible en Archivos.'}
                </span>
                <button type="button" class="btn small" onClick={() => ctx.update({ backupReminderSnoozedUntil: Date.now() + 3 * DAY })}>Luego</button>
                <button type="button" class="btn small primary" onClick={() => setSheet('backup')}>Respaldar</button>
              </div>
            )}
          </div>
          <Screen tab={tab} route={route} />
        </main>
      </div>

      <nav class="tabbar glass" aria-label="Secciones">
        {TABS.filter((t) => 'primary' in t && t.primary).map((t) => (
          <a key={t.id} href={`#/${t.id}`} aria-current={tab === t.id ? 'page' : undefined}>
            <t.icon size={22} aria-hidden="true" />
            {t.label}
          </a>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog">
          <MoreHorizontal size={22} aria-hidden="true" />
          Más
        </button>
      </nav>

      {more && (
        <Sheet title="Más" onClose={() => setMore(false)}>
          {TABS.filter((t) => !('primary' in t)).map((t) => (
            <a key={t.id} class="nav-item" href={`#/${t.id}`} onClick={() => setMore(false)}>
              <t.icon size={20} aria-hidden="true" /> {t.label}
            </a>
          ))}
          <button type="button" class="nav-item" onClick={() => (setMore(false), setSheet('backup'))}>
            <Archive size={20} aria-hidden="true" /> Respaldo
          </button>
        </Sheet>
      )}
      {sheet === 'import' && <ImportSheet onClose={() => setSheet(null)} />}
      {sheet === 'backup' && <BackupSheet onClose={() => setSheet(null)} />}
      {toastMsg && (
        <div class="toast glass dense" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}
    </Ctx.Provider>
  );
}

function Screen(props: { tab: TabId; route: string[] }) {
  switch (props.tab) {
    case 'hoy':
      return <Today />;
    case 'mazos':
      return props.route[1] ? <DeckView path={props.route.slice(1).join('/')} /> : <Decks />;
    case 'ajustes':
      return <SettingsScreen />;
    default:
      return <Placeholder tab={props.tab} />;
  }
}

export { go };
