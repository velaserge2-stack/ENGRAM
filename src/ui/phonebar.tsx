import { t } from '../i18n';
import { Archive, Ellipsis, Settings as Gear, UserRound } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { TABS } from '../nav';
import { useApp } from '../state';
import { Sheet } from './kit';

/**
 * Barra inferior del teléfono (Mejoras 2 · bloque B): Hoy · Mazos · Estudiar · Notas · Más.
 * Solo se monta cuando `isPhone()`; en iPad y web sigue la barra superior en píldora.
 */
const MAIN = ['hoy', 'mazos', 'estudiar', 'notas'];

export function PhoneTabBar(props: { tab: string }) {
  const app = useApp();
  const [more, setMore] = useState(false);
  const main = MAIN.map((id) => TABS.find((x) => x.id === id)!);
  const rest = TABS.filter((x) => !MAIN.includes(x.id));
  const inMore = !MAIN.includes(props.tab);
  return (
    <>
      <nav class="phone-tabbar glass no-print" aria-label={t('app.secciones')}>
        {main.map((x) => (
          <a href={`#/${x.id}`} aria-label={x.label} aria-current={props.tab === x.id ? 'page' : undefined}>
            <x.icon size={22} aria-hidden="true" />
            <span class="lbl" aria-hidden="true">{x.label}</span>
          </a>
        ))}
        <button type="button" aria-label={t('phone.mas')} aria-current={inMore ? 'page' : undefined} aria-haspopup="dialog" onClick={() => setMore(true)}>
          <Ellipsis size={22} aria-hidden="true" />
          <span class="lbl" aria-hidden="true">{t('phone.mas')}</span>
        </button>
      </nav>
      {more && (
        <Sheet title={t('phone.mas')} onClose={() => setMore(false)}>
          <div class="group inset phone-more">
            {rest.map((x) => (
              <a class="row-i tap" href={`#/${x.id}`} aria-current={props.tab === x.id ? 'page' : undefined} onClick={() => setMore(false)}>
                <x.icon size={20} aria-hidden="true" /><span class="k">{x.label}</span>
              </a>
            ))}
            <a class="row-i tap" href="#/perfil" aria-current={props.tab === 'perfil' ? 'page' : undefined} onClick={() => setMore(false)}>
              <UserRound size={20} aria-hidden="true" /><span class="k">{t('profile.perfil')}</span>
            </a>
            <a class="row-i tap" href="#/ajustes" aria-current={props.tab === 'ajustes' ? 'page' : undefined} onClick={() => setMore(false)}>
              <Gear size={20} aria-hidden="true" /><span class="k">{t('app.ajustes')}</span>
            </a>
            <button type="button" class="row-i tap" onClick={() => (setMore(false), app.openSheet('backup'))}>
              <Archive size={20} aria-hidden="true" /><span class="k">{t('app.respaldo')}</span>
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
