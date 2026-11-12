import { locale, t } from '../i18n';
import { Archive, Camera, Settings as Gear, Trash2, UserRound } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { useExtra } from '../data/extra';
import { dayKey, streaks } from '../lib/days';
import { EMPTY_PROFILE, initial, parseProfile, PHOTO_DIR, type Profile, PROFILE_PATH, serializeProfile } from '../lib/profile';
import { activity, studyMs } from '../lib/stats';
import { useApp, useAsync } from '../state';
import { mediaUrl } from '../ui/background';
import { Group, PageTitle, Row } from '../ui/kit';
import { readTextOr } from '../vault/util';

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

/** Recorta al centro y guarda la foto a 512 px. */
async function savePhoto(vault: ReturnType<typeof useApp>['vault'], file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 512, 512);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', 0.88));
  const path = `${PHOTO_DIR}/${Date.now().toString(36)}.jpg`;
  await vault.write(path, new Uint8Array(await blob.arrayBuffer()));
  return path;
}

export function ProfileScreen() {
  const app = useApp();
  const saved = useProfile();
  const [draft, setDraft] = useState<Profile | null>(null);
  const p = draft ?? saved;
  const s = app.settings;
  const { data } = useExtra();
  const log = app.col?.log ?? [];
  const act = activity(log, data?.extra ?? { pomodoro: [], exams: [] }, s.timeZone, s.dayStartHour);
  const today = dayKey(Date.now(), s.timeZone, s.dayStartHour);
  const streak = streaks(new Map([...act].map(([k, v]) => [k, v.cards])), today, s.streakMin).current;
  const cards = app.col?.decks.reduce((n, d) => n + d.cards.length, 0) ?? 0;
  const hours = [...act.values()].reduce((n, a) => n + studyMs(a), 0) / 3_600_000;
  const set = (k: keyof Profile, v: string) => setDraft({ ...p, [k]: v });
  const write = async (next: Profile) => {
    await app.vault.write(PROFILE_PATH, serializeProfile(next));
    setDraft(null);
    app.changed();
  };
  const removePhoto = async (path: string) => { if (path && (await app.vault.exists(path))) await app.vault.remove(path); };
  const field = (k: keyof Profile, label: string, opts: { area?: boolean; max?: number; placeholder?: string } = {}) => (
    <label class="field" style={{ padding: '6px 18px' }}>{label}
      {opts.area
        ? <textarea class="input" rows={3} value={p[k]} maxLength={opts.max} onInput={(e) => set(k, (e.target as HTMLTextAreaElement).value)} data-user-content />
        : <input class="input wide" value={p[k]} maxLength={opts.max} placeholder={opts.placeholder} onInput={(e) => set(k, (e.target as HTMLInputElement).value)} data-user-content />}
    </label>
  );
  const fmt = (n: number, d = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(n);
  return (
    <div class="settings">
      <PageTitle title={t('profile.perfil')} />
      <section class="glass panel profile-head">
        <Avatar profile={p} size={88} />
        <div class="stack-s" style={{ minWidth: 0 }}>
          <h2 class="ellipsis" data-user-content>{p.name || t('profile.sin_nombre')}</h2>
          {p.bio && <p class="t2" style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }} data-user-content>{p.bio}</p>}
          {(p.program || p.institution || p.year) && <p class="foot" data-user-content>{[p.program, p.institution, p.year].filter(Boolean).join(' · ')}</p>}
          {p.motto && <p class="note" data-user-content>“{p.motto}”</p>}
        </div>
        <div class="profile-stats">
          <div><b class="num">{fmt(streak)}</b><span class="foot">{t('profile.racha_actual')}</span></div>
          <div><b class="num">{fmt(cards)}</b><span class="foot">{t('profile.tarjetas_totales')}</span></div>
          <div><b class="num">{fmt(hours, 1)}</b><span class="foot">{t('profile.horas_de_estudio')}</span></div>
        </div>
      </section>

      {/* Perfil como centro (Prompt 6 · B): Ajustes y Respaldo viven aquí */}
      <Group>
        <Row k={<><Gear size={18} aria-hidden="true" /> {t('app.ajustes')}</>} sub={t('profile.ajustes_fila_sub')} onClick={() => (location.hash = '#/ajustes')}><span class="v" aria-hidden="true">›</span></Row>
        <Row k={<><Archive size={18} aria-hidden="true" /> {t('app.respaldo')}</>} sub={s.lastExportAt ? t('profile.respaldo_hace', { n: Math.floor((Date.now() - s.lastExportAt) / 86_400_000) }) : t('profile.respaldo_nunca')} onClick={() => app.openSheet('backup')}><span class="v" aria-hidden="true">›</span></Row>
      </Group>

      <Group title={t('profile.foto_o_emoji')} footer={t('profile.nunca_sale_del_dispositivo')}>
        <Row k={t('profile.foto')}>
          <label class="btn small"><Camera size={16} />{' '}{p.photo ? t('profile.cambiar_foto') : t('profile.elegir_foto')}
            <input type="file" accept="image/*" hidden onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                const old = saved.photo;
                const path = await savePhoto(app.vault, f);
                await write({ ...p, photo: path });
                if (old && old !== path) await removePhoto(old);
              } catch {
                app.toast(t('settings.no_se_pudo_leer_imagen'));
              }
            }} />
          </label>
          {p.photo && <button type="button" class="btn small icon" aria-label={t('profile.quitar_foto')} onClick={async () => { const old = p.photo; await write({ ...p, photo: '' }); await removePhoto(old); }}><Trash2 size={16} /></button>}
        </Row>
        <Row k={t('profile.emoji')} sub={t('profile.emoji_sub')}>
          <input class="input" style={{ width: '90px', textAlign: 'center' }} maxLength={8} value={p.emoji} placeholder="🩺" aria-label={t('profile.emoji')} onInput={(e) => set('emoji', (e.target as HTMLInputElement).value)} data-user-content />
        </Row>
      </Group>

      <Group title={t('profile.datos')}>
        {field('name', t('profile.nombre'), { max: 80 })}
        {field('bio', t('profile.bio'), { area: true, max: 600 })}
        {field('program', t('profile.carrera'), { max: 120 })}
        {field('institution', t('profile.institucion'), { max: 120 })}
        {field('year', t('profile.anio'), { max: 20 })}
        {field('motto', t('profile.lema'), { max: 160 })}
        <div class="row wrap" style={{ padding: '10px 18px 14px', justifyContent: 'flex-end' }}>
          <button type="button" class="btn" disabled={!draft} onClick={() => setDraft(null)}>{t('settings.cancelar')}</button>
          <button type="button" class="btn primary" disabled={!draft} onClick={() => void write(p)}>{t('profile.guardar')}</button>
        </div>
      </Group>
      <div style={{ height: '24px' }} />
    </div>
  );
}
