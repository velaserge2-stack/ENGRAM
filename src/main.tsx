import { render } from 'preact';
import { App } from './app';
import { loadSettings } from './lib/settings';
import { deviceLang, errMsg, setLang, t } from './i18n';
import { perf } from './lib/perf';
import { requestPersist } from './lib/storage';
import { registerSW } from './sw-register';
import { applyTheme, trackKeyboard, trackPhone } from './theme';
import { openVault } from './vault/open';
import { walk } from './vault/util';
import './theme-cristal.css';

let langSet = false;
const demo = new URLSearchParams(location.search).has('demo'); // modo demo: bóveda en memoria, sin red (src/demo/)

async function boot() {
  trackKeyboard();
  trackPhone();
  const d = demo ? await (await import('./demo/boot')).openDemo() : null;
  if (!d) registerSW();
  const opened = d?.opened ?? (await openVault());
  const settings = d?.settings ?? (await loadSettings(opened.vault));
  if (perf.on) void import('./lib/perfhooks').then((m) => m.install(opened.vault)); // solo con ?perf
  setLang(settings.lang || deviceLang());
  langSet = true;
  applyTheme(settings);
  if (settings.welcomeDone && !d) void requestPersist();
  const hasData = (await walk(opened.vault, 'decks')).length + (await walk(opened.vault, 'notes')).length > 0;
  const root = document.getElementById('app')!;
  root.textContent = '';
  render(<App opened={opened} initialSettings={settings} hasData={hasData} />, root);
  if (d) void import('./demo/boot').then((m) => m.announce());
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app')!;
  if (!langSet) setLang(deviceLang());
  root.innerHTML = '<div style="padding:40px;font-family:system-ui"><h1></h1><p></p></div>';
  root.querySelector('h1')!.textContent = t('main.no_se_pudo_abrir_la_boveda');
  root.querySelector('p')!.textContent = errMsg(e);
});
