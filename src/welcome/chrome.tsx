import { LANGS, t, type Lang } from '../i18n';
import { Ic } from './icons';

export interface Chrome { dark: boolean; setDark: (d: boolean) => void; lang: Lang; setLang: (l: Lang) => void }

export function ThemeSeg(p: Chrome) {
  return (
    <div class="bv-seg" role="group" aria-label={t('bienvenida.tema')}>
      <button type="button" aria-pressed={!p.dark} aria-label={t('bienvenida.tema_claro')} onClick={() => p.setDark(false)}><Ic n="sun" /></button>
      <button type="button" aria-pressed={p.dark} aria-label={t('bienvenida.tema_oscuro')} onClick={() => p.setDark(true)}><Ic n="moon" /></button>
    </div>
  );
}
export function LangSeg(p: Chrome) {
  return (
    <div class="bv-seg" role="group" aria-label={t('bienvenida.idioma')}>
      {LANGS.map((l) => <button type="button" key={l.id} lang={l.id} aria-pressed={p.lang === l.id} onClick={() => p.setLang(l.id)}>{l.id}</button>)}
    </div>
  );
}

