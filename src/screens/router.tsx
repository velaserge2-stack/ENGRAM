import { t } from '../i18n';
import { lazy, Suspense } from 'preact/compat';
import { Decks } from './decks'; // ya va en el paquete inicial (Hoy usa DeckPanel)
import { Today } from './today';
import { useEffect } from 'preact/hooks';
import { useApp } from '../state';
import { addonOn } from './addons';

// Pantallas pesadas: carga diferida (import dinámico)
const DeckEditor = lazy(() => import('./deck').then((m) => ({ default: m.DeckEditor })));
const Explorar = lazy(() => import('./explorar').then((m) => ({ default: m.Explorar })));
const SettingsScreen = lazy(() => import('./settings').then((m) => ({ default: m.SettingsScreen })));
const Stats = lazy(() => import('./stats').then((m) => ({ default: m.Stats })));
const Study = lazy(() => import('./study').then((m) => ({ default: m.Study })));
const Simulacros = lazy(() => import('./simulacros').then((m) => ({ default: m.Simulacros })));
const Calendar = lazy(() => import('./calendar').then((m) => ({ default: m.Calendar })));
const Notes = lazy(() => import('./notes').then((m) => ({ default: m.Notes })));
const Spaces = lazy(() => import('./spaces').then((m) => ({ default: m.Spaces })));
const Inbox = lazy(() => import('./inbox').then((m) => ({ default: m.Inbox })));
const PdfsScreen = lazy(() => import('./pdfs').then((m) => ({ default: m.Pdfs })));
const Profile = lazy(() => import('./profile').then((m) => ({ default: m.ProfileScreen })));
const Design = lazy(() => import('./design').then((m) => ({ default: m.Design })));

/** Ruta no disponible: vuelve a Hoy (sin dejar la entrada en el historial). */
function GoHome() {
  useEffect(() => { location.replace('#/hoy'); }, []);
  return <Today />;
}

export function Screen(props: { route: string[] }) {
  const app = useApp();
  const [tab, ...rest] = props.route;
  const sub = rest.join('/');
  let el: preact.JSX.Element;
  switch (tab) {
    case 'mazos': el = sub ? <DeckEditor key={sub} path={sub} /> : <Decks />; break;
    case 'estudiar': el = <Study key={sub} filter={sub || null} />; break;
    case 'explorar': el = <Explorar key={sub} q={sub} />; break;
    case 'estadisticas': el = <Stats />; break;
    case 'ajustes': el = <SettingsScreen focus={sub || null} />; break;
    case 'simulacros': el = <Simulacros route={rest} />; break;
    case 'calendario': el = <Calendar />; break;
    case 'notas': el = <Notes route={rest} />; break;
    case 'espacios': el = <Spaces route={rest} />; break;
    // Prompt 6 · C: con el add-on apagado, #/bandeja lleva a Hoy
    case 'bandeja': el = addonOn(app.settings, 'inbox') ? <Inbox /> : <GoHome />; break;
    case 'addons': el = <SettingsScreen focus="addons" />; break; // enlaces antiguos
    case 'perfil': el = <Profile />; break;
    case 'pdfs': el = <PdfsScreen route={rest} />; break;
    case 'design': el = <Design key={location.hash} />; break;
    default: el = <Today />;
  }
  return <Suspense fallback={<p class="t2">{t('deck.cargando')}</p>}>{el}</Suspense>;
}
