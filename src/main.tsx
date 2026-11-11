import { render } from 'preact';
import { App } from './app';
import { loadSettings } from './lib/settings';
import { deviceLang, setLang } from './i18n';
import { requestPersist } from './lib/storage';
import { registerSW } from './sw-register';
import { applyTheme, trackKeyboard } from './theme';
import { openVault } from './vault/open';
import { walk } from './vault/util';
import './theme-cristal.css';

async function boot() {
  trackKeyboard();
  registerSW();
  const opened = await openVault();
  const settings = await loadSettings(opened.vault);
  setLang(settings.lang || deviceLang());
  applyTheme(settings);
  if (settings.welcomeDone) void requestPersist();
  const hasData = (await walk(opened.vault, 'decks')).length + (await walk(opened.vault, 'notes')).length > 0;
  const root = document.getElementById('app')!;
  root.textContent = '';
  render(<App opened={opened} initialSettings={settings} hasData={hasData} />, root);
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app')!;
  root.innerHTML = '<div style="padding:40px;font-family:system-ui"><h1>No se pudo abrir la bóveda</h1><p></p></div>';
  root.querySelector('p')!.textContent = String((e as Error)?.message ?? e);
});
