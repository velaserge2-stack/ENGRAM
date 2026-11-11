import { t } from '../i18n';
import { ExternalLink, Music, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, Upload } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ambient, player } from '../lib/ambient';
import { fadeGain, sleepAt, SOUNDS, type SoundId } from '../lib/noise';
import type { Settings } from '../lib/settings';
import { useApp, useAsync } from '../state';
import { mediaUrl } from '../ui/background';
import { Group, Row, Segmented, Switch } from '../ui/kit';
import { walk } from '../vault/util';

export const MUSIC_DIR = 'media/audio';
type SleepChoice = 0 | 15 | 30 | 60 | 'pomodoro';

/** Temporizador de apagado (no se guarda: una sesión). */
const sleep = { at: null as number | null, choice: 0 as SleepChoice };

function useTick(ms: number, on: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const iv = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(iv); }, [on, ms]);
}
function useEngine() {
  const [, set] = useState(0);
  useEffect(() => { const a = ambient.subscribe(() => set((n) => n + 1)); const b = player.subscribe(() => set((n) => n + 1)); return () => (a(), b()); }, []);
}

/**
 * Vigila el temporizador de apagado, el pomodoro («solo durante el enfoque») y la voz o el
 * audio de las tarjetas («atenuar al estudiar»). Se monta en App solo con el add-on activo.
 */
export function AmbientController() {
  const app = useApp();
  const a = app.settings.ambient;
  const p = app.pomo.state;
  useEffect(() => {
    const iv = setInterval(() => {
      if (sleep.choice === 'pomodoro' && sleep.at === null) sleep.at = sleepAt(Date.now(), 'pomodoro', p);
      if (sleep.at !== null && fadeGain(Date.now(), sleep.at) < 1) {
        ambient.fadeOut(Math.max(0, sleep.at - Date.now()));
        player.fadeOut(Math.max(0, sleep.at - Date.now()));
        sleep.at = null;
        sleep.choice = 0;
      }
    }, 500);
    return () => clearInterval(iv);
  }, [p.running, p.phase, p.endAt]);
  // solo durante el enfoque: silenciar en los descansos (la alarma del pomodoro va aparte y siempre suena)
  useEffect(() => { ambient.set({ mute: a.onlyFocus && p.phase !== 'work' }); }, [a.onlyFocus, p.phase]);
  // atenuar mientras suena la voz o el audio de una tarjeta
  useEffect(() => {
    if (!a.duck) return;
    const duck = (on: boolean) => (ambient.set({ duck: on }), player.setDuck(on));
    const onSpeak = (e: Event) => duck((e as CustomEvent<boolean>).detail);
    const onMedia = (e: Event) => { const el = e.target as HTMLElement; if (el.tagName === 'AUDIO' && el.closest('.study-card')) duck(e.type === 'play'); };
    addEventListener('engrama-duck', onSpeak);
    document.addEventListener('play', onMedia, true);
    document.addEventListener('pause', onMedia, true);
    document.addEventListener('ended', onMedia, true);
    return () => { removeEventListener('engrama-duck', onSpeak); document.removeEventListener('play', onMedia, true); document.removeEventListener('pause', onMedia, true); document.removeEventListener('ended', onMedia, true); duck(false); };
  }, [a.duck]);
  return null;
}

const label = (id: SoundId) => t(`ambient.s_${id}`);

/** Mini reproductor (panel pequeño, panel del lienzo o hoja). */
export function AmbientPlayer() {
  const app = useApp();
  const s = app.settings.ambient;
  useEngine();
  useTick(1000, sleep.at !== null);
  const set = (patch: Partial<Settings['ambient']>) => app.update({ ambient: { ...s, ...patch } });
  const setLevel = (id: SoundId, v: number) => {
    const levels = { ...s.levels, [id]: v };
    set({ levels });
    ambient.setLevels(levels);
  };
  const { data: tracks } = useAsync(async () => (await walk(app.vault, MUSIC_DIR)).filter((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f.name)).map((f) => ({ path: f.path, title: f.name.replace(/\.[^.]+$/, '') })), [app.version]);
  const [dur, setDur] = useState<Record<string, number>>({});
  const playList = async (start: number) => {
    const list = await Promise.all((tracks ?? []).map(async (x) => ({ ...x, url: (await mediaUrl(app.vault, x.path)) ?? '' })));
    player.play(list, start, { shuffle: s.shuffle, loop: s.loop });
  };
  const [, bump] = useState(0);
  const choose = (c: SleepChoice) => { sleep.choice = c; sleep.at = sleepAt(Date.now(), c, app.pomo.state); bump((n) => n + 1); if (c === 'pomodoro' && sleep.at === null) app.toast(t('ambient.sin_pomodoro')); };
  const left = sleep.at ? Math.max(0, Math.ceil((sleep.at - Date.now()) / 60000)) : null;
  const anyLevel = SOUNDS.some((id) => (s.levels[id] ?? 0) > 0);
  if (!ambient.supported()) return <p class="t2">{t('ambient.no_soportado')}</p>;
  return (
    <div class="stack ambient">
      <div class="row wrap">
        {ambient.playing
          ? <button type="button" class="btn primary" onClick={() => ambient.stop()}><Square size={18} />{' '}{t('ambient.detener')}</button>
          : <button type="button" class="btn primary" disabled={!anyLevel} onClick={() => ambient.play(s.levels, s.background)}><Play size={18} />{' '}{t('ambient.reproducir')}</button>}
        <span class="foot grow">{anyLevel ? '' : t('ambient.sube_un_volumen')}</span>
      </div>
      <Group title={t('ambient.sonidos')}>
        {SOUNDS.map((id) => (
          <Row k={label(id)} sub={`${Math.round((s.levels[id] ?? 0) * 100)} %`}>
            <input type="range" min={0} max={100} step={5} value={Math.round((s.levels[id] ?? 0) * 100)} aria-label={t('ambient.volumen_x', { name: label(id) })} onInput={(e) => setLevel(id, Number((e.target as HTMLInputElement).value) / 100)} />
          </Row>
        ))}
      </Group>
      <Group title={t('ambient.apagado')}>
        <div class="row-i"><Segmented label={t('ambient.apagado')} value={String(sleep.choice) as string} onChange={(v) => choose((v === 'pomodoro' ? 'pomodoro' : Number(v)) as SleepChoice)} options={[['0', t('ambient.sin_temporizador')], ['15', '15 min'], ['30', '30 min'], ['60', '60 min'], ['pomodoro', t('ambient.al_terminar_pomodoro')]]} /></div>
        {left !== null && <Row k={t('ambient.se_apaga_en', { n: left })} />}
      </Group>
      <Group title={t('ambient.opciones')} footer={t('ambient.limites_safari')}>
        <Row k={t('ambient.solo_enfoque')} sub={t('ambient.solo_enfoque_sub')}><Switch label={t('ambient.solo_enfoque')} checked={s.onlyFocus} onChange={(v) => set({ onlyFocus: v })} /></Row>
        <Row k={t('ambient.atenuar')} sub={t('ambient.atenuar_sub')}><Switch label={t('ambient.atenuar')} checked={s.duck} onChange={(v) => set({ duck: v })} /></Row>
        <Row k={t('ambient.segundo_plano')} sub={t('ambient.segundo_plano_sub')}><Switch label={t('ambient.segundo_plano')} checked={s.background} onChange={(v) => { set({ background: v }); if (ambient.playing) ambient.play(s.levels, v); }} /></Row>
      </Group>
      <Group title={t('ambient.musica')} footer={t('ambient.musica_nota')}>
        <div class="row-i wrap">
          <label class="btn small"><Upload size={16} />{' '}{t('ambient.importar_audio')}
            <input type="file" accept="audio/*,.mp3,.m4a,.wav" multiple hidden onChange={async (e) => {
              const files = [...((e.target as HTMLInputElement).files ?? [])];
              for (const f of files) await app.vault.write(`${MUSIC_DIR}/${f.name.replace(/[\\/:*?"<>|#]+/g, '_')}`, new Uint8Array(await f.arrayBuffer()));
              app.changed();
              app.toast(t('ambient.n_pistas', { n: files.length }));
            }} />
          </label>
          <button type="button" class="btn small icon" aria-label={t('ambient.anterior')} disabled={!player.current} onClick={() => player.prev()}><SkipBack size={16} /></button>
          {player.playing ? <button type="button" class="btn small icon" aria-label={t('ambient.pausar')} onClick={() => player.pause()}><Pause size={16} /></button> : <button type="button" class="btn small icon" aria-label={t('ambient.reproducir')} disabled={!tracks?.length} onClick={() => (player.current ? player.resume() : void playList(0))}><Play size={16} /></button>}
          <button type="button" class="btn small icon" aria-label={t('ambient.siguiente')} disabled={!player.current} onClick={() => player.next()}><SkipForward size={16} /></button>
          <button type="button" class="btn small icon" aria-label={t('ambient.bucle')} aria-pressed={s.loop} onClick={() => set({ loop: !s.loop })}><Repeat size={16} /></button>
          <button type="button" class="btn small icon" aria-label={t('ambient.aleatorio')} aria-pressed={s.shuffle} onClick={() => set({ shuffle: !s.shuffle })}><Shuffle size={16} /></button>
        </div>
        {tracks?.map((x, i) => (
          <button type="button" class="row-i tap track" aria-current={player.current?.path === x.path ? 'true' : undefined} onClick={() => void playList(i)}>
            <Music size={16} aria-hidden="true" /><span class="k ellipsis" data-user-content>{x.title}</span>
            <span class="v num">{dur[x.path] ? `${Math.floor(dur[x.path]! / 60)}:${String(Math.round(dur[x.path]! % 60)).padStart(2, '0')}` : <Duration path={x.path} onDur={(d) => setDur((m) => ({ ...m, [x.path]: d }))} />}</span>
          </button>
        ))}
        <Row k={t('ambient.app_de_musica')} sub={t('ambient.app_de_musica_sub')}>
          <input class="input" style={{ width: '180px' }} value={s.musicUrl} placeholder="https://…" aria-label={t('ambient.enlace_app')} onChange={(e) => set({ musicUrl: (e.target as HTMLInputElement).value.trim() })} />
          {/^[a-z][a-z0-9+.-]*:\/\//i.test(s.musicUrl) && <a class="btn small" href={s.musicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{' '}{t('ambient.abrir')}</a>}
        </Row>
      </Group>
    </div>
  );
}

/** Duración leída de los metadatos del archivo (sin reproducir). */
function Duration(p: { path: string; onDur: (s: number) => void }) {
  const app = useApp();
  useEffect(() => {
    let alive = true;
    void mediaUrl(app.vault, p.path).then((url) => {
      if (!url || !alive) return;
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => alive && Number.isFinite(a.duration) && p.onDur(a.duration);
      a.src = url;
    });
    return () => { alive = false; };
  }, [p.path]);
  return <>—</>;
}
