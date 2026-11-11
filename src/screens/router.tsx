import { t } from '../i18n';
import { lazy, Suspense } from 'preact/compat';
import { Decks } from './decks';
import { DeckEditor } from './deck';
import { Explorar } from './explorar';
import { SettingsScreen } from './settings';
import { Stats } from './stats';
import { Study } from './study';
import { Today } from './today';

// Pantallas pesadas: carga diferida (import dinámico)
const Simulacros = lazy(() => import('./simulacros').then((m) => ({ default: m.Simulacros })));
const Calendar = lazy(() => import('./calendar').then((m) => ({ default: m.Calendar })));
const Notes = lazy(() => import('./notes').then((m) => ({ default: m.Notes })));
const Spaces = lazy(() => import('./spaces').then((m) => ({ default: m.Spaces })));
const Inbox = lazy(() => import('./inbox').then((m) => ({ default: m.Inbox })));
const Profile = lazy(() => import('./profile').then((m) => ({ default: m.ProfileScreen })));
const Design = lazy(() => import('./design').then((m) => ({ default: m.Design })));

export function Screen(props: { route: string[] }) {
  const [tab, ...rest] = props.route;
  const sub = rest.join('/');
  let el: preact.JSX.Element;
  switch (tab) {
    case 'mazos': el = sub ? <DeckEditor path={sub} /> : <Decks />; break;
    case 'estudiar': el = <Study key={sub} filter={sub || null} />; break;
    case 'explorar': el = <Explorar key={sub} q={sub} />; break;
    case 'estadisticas': el = <Stats />; break;
    case 'ajustes': el = <SettingsScreen focus={sub || null} />; break;
    case 'simulacros': el = <Simulacros route={rest} />; break;
    case 'calendario': el = <Calendar />; break;
    case 'notas': el = <Notes route={rest} />; break;
    case 'espacios': el = <Spaces route={rest} />; break;
    case 'bandeja': el = <Inbox />; break;
    case 'addons': el = <SettingsScreen focus="addons" />; break; // enlaces antiguos
    case 'perfil': el = <Profile />; break;
    case 'design': el = <Design key={location.hash} />; break;
    default: el = <Today />;
  }
  return <Suspense fallback={<p class="t2">{t('deck.cargando')}</p>}>{el}</Suspense>;
}
