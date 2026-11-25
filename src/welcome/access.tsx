import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { InstallSteps } from '../screens/install';
import { Ic } from './icons';

/** Evento de instalación de Chromium/Edge (feature detection: en Safari nunca llega). */
interface InstallEvt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvt | null = null;
export function captureInstall() {
  if (!('onbeforeinstallprompt' in window)) return () => {};
  const on = (e: Event) => { e.preventDefault(); deferred = e as InstallEvt; };
  addEventListener('beforeinstallprompt', on);
  return () => removeEventListener('beforeinstallprompt', on);
}

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Crear cuenta: solo el correo. No se guarda ni se envía a ningún lado; solo lleva a Instalar. */
export function Crear() {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    const s = v.trim();
    const msg = !s ? t('bienvenida.err_vacio') : !MAIL.test(s) ? t('bienvenida.err_inv') : '';
    setErr(msg);
    if (msg) { inp.current?.focus(); return; }
    setV('');
    location.hash = '#/bienvenida/instalar';
  };
  return (
    <div class="bv-ac">
      <div class="bv-ac-col">
        <span class="bv-tile bv-ac-m"><Ic n="grex" /></span>
        <h1 class="bv-ac-h" tabIndex={-1}>{t('bienvenida.cr_t')}</h1>
        <p class="bv-ac-s">{t('bienvenida.cr_s')}</p>
        <ul class="bv-ac-b">
          {['cr_b1', 'cr_b2', 'cr_b3'].map((k) => <li key={k}><Ic n="check" />{t(`bienvenida.${k}`)}</li>)}
        </ul>
      </div>
      <form class="bv-glass bv-ac-card" onSubmit={submit} noValidate>
        <label class="bv-lab" for="bv-mail">{t('bienvenida.correo')}</label>
        <input id="bv-mail" ref={inp} class="bv-in" type="email" name="email" autocomplete="email" inputMode="email" autocapitalize="off" spellcheck={false}
          placeholder={t('bienvenida.correo_ph')} value={v} onInput={(e) => { setV((e.target as HTMLInputElement).value); if (err) setErr(''); }}
          aria-invalid={err ? 'true' : 'false'} aria-describedby={err ? 'bv-mail-err' : undefined} />
        <p id="bv-mail-err" class="bv-err" role="alert" hidden={!err}>{err && <><i aria-hidden="true">!</i>{err}</>}</p>
        <button type="submit" class="bv-btn ink bv-wide">{t('bienvenida.continuar')}<Ic n="arrow" /></button>
        <p class="bv-small bv-center">{t('bienvenida.sin_servidor')}</p>
        <p class="bv-small bv-center">{t('bienvenida.ya_cuenta')} <a class="bv-link" href="#/bienvenida/instalar">{t('bienvenida.login')}</a></p>
      </form>
    </div>
  );
}

export function Instalar() {
  const [hl, setHl] = useState(false);
  const steps = useRef<HTMLElement>(null);
  useEffect(() => captureInstall(), []);
  const go = async () => {
    if (deferred) {
      const d = deferred;
      deferred = null;
      try { await d.prompt(); await d.userChoice; } catch { /* el usuario cerró el aviso */ }
      return;
    }
    setHl(true);
    steps.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    steps.current?.focus();
  };
  return (
    <div class="bv-inst">
      <img class="bv-logo" src="brand/logo-256.png" width="96" height="96" alt="" />
      <h1 class="bv-ac-h" tabIndex={-1}>{t('bienvenida.inst_t')}</h1>
      <button type="button" class="bv-btn ink bv-big" onClick={go}><Ic n="down" />{t('bienvenida.inst_btn')}</button>
      <section ref={steps} tabIndex={-1} class={`bv-glass bv-steps${hl ? ' hl' : ''}`} aria-label={t('bienvenida.inst_pasos')}>
        <InstallSteps />
      </section>
      <p class="bv-small">{t('bienvenida.inst_nota')}</p>
      <a class="bv-link bv-small" href="./?app">{t('bienvenida.inst_sin')}</a>
    </div>
  );
}
