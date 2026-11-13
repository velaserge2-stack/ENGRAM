import { UserRound } from 'lucide-preact';
import { EMPTY_PROFILE, initial, parseProfile, type Profile, PROFILE_PATH } from '../lib/profile';
import { useApp, useAsync } from '../state';
import { readTextOr } from '../vault/util';
import { mediaUrl } from './background';


/** Perfil compartido por la barra superior, Hoy y la pantalla de perfil. */
export function useProfile(): Profile {
  const app = useApp();
  const { data } = useAsync(async () => parseProfile(await readTextOr(app.vault, PROFILE_PATH, '')), [app.version]);
  return data ?? EMPTY_PROFILE;
}

/** Foto, emoji o inicial (en ese orden); sin nada, un icono neutro. */
export function Avatar(props: { profile: Profile; size: number }) {
  const app = useApp();
  const { data: url } = useAsync(async () => (props.profile.photo ? mediaUrl(app.vault, props.profile.photo) : null), [props.profile.photo]);
  const s = `${props.size}px`;
  const p = props.profile;
  return (
    <span class="avatar" style={{ width: s, height: s, fontSize: `${Math.round(props.size * 0.46)}px` }} aria-hidden="true" data-user-content={url || p.emoji ? '' : undefined}>
      {url ? <img src={url} alt="" /> : p.emoji ? <span>{p.emoji}</span> : initial(p) ? <b>{initial(p)}</b> : <UserRound size={Math.round(props.size * 0.55)} />}
    </span>
  );
}
