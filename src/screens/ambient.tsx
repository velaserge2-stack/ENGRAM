import { t } from '../i18n';
import { ExternalLink, Music, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Square, Upload } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Portal } from '../ui/overlay';
import { ambient, onAudioError, player } from '../lib/ambient';
import { fadeGain, sleepAt, SOUNDS, type SoundId } from '../lib/noise';
import type { Settings } from '../lib/settings';
import { useApp, useAsync } from '../state';
import { mediaUrl } from '../ui/background';
import { Group, Row, Segmented, Switch } from '../ui/kit';
import { walk } from '../vault/util';

const MUSIC_DIR = 'media/audio';
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
  // solo durante el enfoque: silenciar en los descansos de un pomodoro EN MARCHA (la alarma va aparte).
  // Antes bastaba la fase: un pomodoro detenido en «descanso» dejaba el sonido mudo para siempre.
  useEffect(() => { ambient.set({ mute: a.onlyFocus && p.running && p.phase !== 'work' }); }, [a.onlyFocus, p.phase, p.running]);
  // un play() rechazado ya no se esconde: aviso discreto con la causa
  useEffect(() => onAudioError((e) => app.toast(e.name === 'NotAllowedError' ? t('audio.no_permitido') : e.name === 'NotSupportedError' ? t('audio.no_soportado') : t('audio.error', { name: e.name }))), []);
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
  const { data: tracks } = useAsync(async () => (await walk(app.vault, MUSIC_DIR)).filter((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f.name)).map((f) => ({ path: f.path, title: f.name.replace(/\.[^.]+$/, '') })), [app.version, app.notesVersion]);
  const [dur, setDur] = useState<Record<string, number>>({});
  const playList = async (start: number) => {
    player.prime(); // en el mismo toque, antes de leer los archivos (Safari)
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
        <button type="button" class="btn small" onClick={async () => { const st = await ambient.test(); app.toast(st === 'running' ? t('audio.prueba_ok') : st === 'none' ? t('ambient.no_soportado') : t('audio.prueba_pausa', { state: st })); }}>{t('audio.probar')}</button>
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

/**
 * Mini reproductor (Prompt 6 · D, unificado): UNA superficie de vidrio para los dos motores. En
 * píldora muestra lo que suena y reproducir/pausar; al pasar el cursor (150 ms), con el foco del
 * teclado o al tocarlo crece en el mismo contenedor (sin otra ventana): una línea por motor
 * (ambiente y música), anterior/siguiente, progreso de la pista, volumen y «Abrir panel completo».
 * Esc o salir lo pliega. Nunca inicia audio al pasar el cursor: solo los botones (toques).
 * Visible mientras algo suena o quedó en pausa con algo cargado.
 */
export function MiniAmbient(p: { floating?: boolean }) {
  const app = useApp();
  const s = app.settings.ambient;
  useEngine();
  useTick(1000, sleep.at !== null || player.playing);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const box = useRef<HTMLDivElement>(null);
  // expandido: tocar fuera lo pliega (como hacía el popover de antes)
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) (clearTimeout(timer.current), setOpen(false)); };
    document.addEventListener('pointerdown', out, true);
    return () => document.removeEventListener('pointerdown', out, true);
  }, [open]);
  const musicOn = !!player.current && (player.playing || musicHeld.on);
  const sounding = ambient.playing || player.playing;
  const ambOn = ambient.playing || ambient.paused;
  const visible = sounding || ambient.paused || musicHeld.on;
  useEffect(() => { if (player.playing) musicHeld.on = false; if (!visible) setOpen(false); }, [player.playing, visible]);
  if (!visible) return null;
  const layers = SOUNDS.filter((id) => (s.levels[id] ?? 0) > 0);
  const mix = layers.length ? layers.map(label).join(' + ') : t('addons.n_ambient');
  const title = musicOn && player.current ? player.current.title : mix;
  const later = (on: boolean, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(on), ms); };
  const toggle = () => {
    if (sounding) { ambient.pause(); if (player.playing) { musicHeld.on = true; player.pause(); } }
    else { ambient.resume(); if (musicHeld.on) { musicHeld.on = false; player.resume(); } }
  };
  const setLevel = (id: SoundId, v: number) => { const levels = { ...s.levels, [id]: v }; app.update({ ambient: { ...s, levels } }); ambient.setLevels(levels); };
  const left = sleep.at ? Math.max(0, Math.ceil((sleep.at - Date.now()) / 60000)) : null;
  const mouse = (e: PointerEvent) => e.pointerType !== 'touch';
  const tm = player.time;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const playBtn = <button type="button" class="btn icon small ghost" aria-label={sounding ? t('ambient.pausar') : t('mini.reanudar')} onClick={toggle}>{sounding ? <Pause size={16} /> : <Play size={16} />}</button>;
  return (
    <Portal>
      <div ref={box} class={`mini-amb glass${p.floating ? ' floating' : ' docked'}${sounding ? ' on' : ''}${open ? ' open' : ''}`} role="group" aria-label={t('mini.reproductor')}
        onPointerEnter={(e) => mouse(e) && later(true, 150)} onPointerLeave={(e) => mouse(e) && later(false, 300)}
        onFocusIn={(e) => (e.target as HTMLElement).matches(':focus-visible') && later(true, 0)}
        onFocusOut={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) later(false, 300); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) (e.stopPropagation(), clearTimeout(timer.current), setOpen(false)); }}>
        <div class="mini-amb-pill">
          <button type="button" class="mini-amb-main" aria-expanded={open} aria-label={t('mini.controles_de', { name: title })} onClick={(e) => { if ((e as unknown as PointerEvent).pointerType === 'mouse') return; clearTimeout(timer.current); setOpen(!open); }}>
            <span class="bars" aria-hidden="true"><i /><i /><i /></span>
            <span class="ellipsis mini-amb-t" data-user-content={musicOn ? '' : undefined}>{title}</span>
          </button>
          {playBtn}
        </div>
        <span class="sr-only" role="status" aria-live="polite">{sounding ? t('mini.sonando', { name: title }) : t('mini.en_pausa')}</span>
        {open && (
          <div class="mini-amb-x stack-s">
            {ambOn && <div class="mini-amb-line"><span class="foot">{t('addons.n_ambient')}</span><b class="ellipsis">{mix}</b></div>}
            {player.current && (
              <div class="mini-amb-line">
                <span class="foot">{t('mini.musica')}</span>
                <b class="ellipsis" data-user-content>{player.current.title}</b>
                {tm.dur > 0 && <div class="mini-amb-prog" role="progressbar" aria-label={t('mini.progreso')} aria-valuemin={0} aria-valuemax={Math.round(tm.dur)} aria-valuenow={Math.round(tm.at)} aria-valuetext={`${mmss(tm.at)} / ${mmss(tm.dur)}`}><i style={{ width: `${Math.min(100, (tm.at / tm.dur) * 100)}%` }} /></div>}
              </div>
            )}
            <div class="row">
              {musicOn && <button type="button" class="btn icon small" aria-label={t('ambient.anterior')} onClick={() => player.prev()}><SkipBack size={16} /></button>}
              <button type="button" class="btn icon small" aria-label={sounding ? t('ambient.pausar') : t('mini.reanudar')} onClick={toggle}>{sounding ? <Pause size={16} /> : <Play size={16} />}</button>
              {musicOn && <button type="button" class="btn icon small" aria-label={t('ambient.siguiente')} onClick={() => player.next()}><SkipForward size={16} /></button>}
              <span class="grow" />
              {left !== null && <span class="foot">{t('ambient.se_apaga_en', { n: left })}</span>}
            </div>
            <label class="mini-amb-row"><span>{t('mini.volumen_general')}</span><input type="range" min={0} max={100} step={5} value={Math.round(ambient.volume * 100)} aria-label={t('mini.volumen_general')} onInput={(e) => ambient.setVolume(Number((e.target as HTMLInputElement).value) / 100)} /></label>
            {ambOn && layers.map((id) => (
              <label class="mini-amb-row"><span>{label(id)}</span><input type="range" min={0} max={100} step={5} value={Math.round((s.levels[id] ?? 0) * 100)} aria-label={t('ambient.volumen_x', { name: label(id) })} onInput={(e) => setLevel(id, Number((e.target as HTMLInputElement).value) / 100)} /></label>
            ))}
            <button type="button" class="btn small" onClick={() => { setOpen(false); app.openSheet('ambient'); }}><ExternalLink size={14} />{' '}{t('mini.abrir_panel')}</button>
          </div>
        )}
      </div>
    </Portal>
  );
}
/** Música pausada desde el mini reproductor (para poder reanudarla desde él). */
const musicHeld = { on: false };
