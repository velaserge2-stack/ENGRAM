import { useEffect, useState } from 'preact/hooks';
import { getLang, t } from '../i18n';
import { useApp } from '../state';
import { Crear, Instalar, captureInstall } from './access';
import { Landing } from './landing';
import { LangSeg, ThemeSeg, type Chrome } from './chrome';
import './welcome.css';

type Page = 'home' | 'crear' | 'instalar';
const pageOf = (): Page => {
  const h = location.hash;
  return h.startsWith('#/bienvenida/crear') ? 'crear' : h.startsWith('#/bienvenida/instalar') ? 'instalar' : 'home';
};

export default function Bienvenida() {
  const app = useApp();
  const [page, setPage] = useState<Page>(pageOf);
  const [dark, setDark] = useState(false); // claro por defecto; no se guarda
  const lang = getLang();
  const chrome: Chrome = { dark, setDark, lang, setLang: (l) => app.update({ lang: l }) };
  useEffect(() => {
    const on = () => { setPage(pageOf()); document.getElementById('bv-root')?.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    const off = captureInstall();
    return () => { removeEventListener('hashchange', on); off(); };
  }, []);
  return (
    <div id="bv-root" class={`bv-root${dark ? ' dark' : ''}`} lang={lang}>
      <div class="bv-bg" aria-hidden="true" />
      {page === 'home' ? <Landing {...chrome} /> : (
        <main class="bv-sub">
          <nav class="bv-nav bv-glass" aria-label={t('bienvenida.principal')}>
            <a class="bv-brand" href="#/bienvenida" aria-label={t('bienvenida.inicio')}><i><img src="brand/logo-64.png" alt="" /></i>Engrama</a>
            <span class="bv-sp" />
            <a class="bv-l" href="#/bienvenida">{t('bienvenida.volver')}</a>
            <ThemeSeg {...chrome} />
            <LangSeg {...chrome} />
          </nav>
          {page === 'crear' ? <Crear /> : <Instalar />}
        </main>
      )}
    </div>
  );
}
