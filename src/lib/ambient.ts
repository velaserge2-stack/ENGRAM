/**
 * Motor de sonido ambiente (Prompt 5 · A).
 *
 * - Primer plano: Web Audio (mezcla en vivo, volumen por sonido, desvanecimiento exacto).
 * - «Seguir sonando con la pantalla bloqueada»: la mezcla se renderiza a un bucle WAV y suena
 *   con un elemento <audio> + Media Session (título y controles en la pantalla bloqueada).
 *   Safari suspende el AudioContext en segundo plano; un <audio> de la página puede seguir.
 * - Nada suena sin un toque: el AudioContext se crea dentro del gesto que pulsa «Reproducir».
 * - Música propia: otro <audio> con lista, bucle y aleatorio (archivos en media/audio/).
 */
import { mix, SOUNDS, type SoundId, wav } from './noise';

type Levels = Partial<Record<SoundId, number>>;
type Ctx = AudioContext;

const LOOP_S = 12;
let ctx: Ctx | null = null;
let master: GainNode | null = null;
const live = new Map<SoundId, { src: AudioBufferSourceNode; gain: GainNode }>();
const buffers = new Map<SoundId, AudioBuffer>();
let bg: HTMLAudioElement | null = null;
let bgUrl: string | null = null;
let duckOn = false;
let muted = false;
let playing = false;
let mode: 'live' | 'background' = 'live';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function ensureCtx(): Ctx | null {
  if (ctx) return ctx;
  const C = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // Safari suspende el contexto al bloquear o salir: reanudar al volver
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing && ctx?.state !== 'running') void ctx?.resume(); });
  return ctx;
}

function bufferFor(id: SoundId): AudioBuffer {
  let b = buffers.get(id);
  if (!b) {
    const c = ctx!;
    const data = mix({ [id]: 1 }, LOOP_S, c.sampleRate);
    b = c.createBuffer(1, data.length, c.sampleRate);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    buffers.set(id, b);
  }
  return b;
}

/** Volumen general (mini reproductor, Prompt 6 · D); por sesión, como el temporizador. */
let volume = 1;
let paused = false;
const target = () => (muted ? 0 : (duckOn ? 0.25 : 1) * volume);

function applyLive(levels: Levels) {
  const c = ctx!;
  for (const id of SOUNDS) {
    const v = levels[id] ?? 0;
    const cur = live.get(id);
    if (v > 0 && !cur) {
      const src = c.createBufferSource();
      src.buffer = bufferFor(id);
      src.loop = true;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(master!);
      src.start();
      gain.gain.setTargetAtTime(v, c.currentTime, 0.15);
      live.set(id, { src, gain });
    } else if (cur && v > 0) cur.gain.gain.setTargetAtTime(v, c.currentTime, 0.1);
    else if (cur) {
      cur.gain.gain.setTargetAtTime(0, c.currentTime, 0.1);
      const s = cur.src;
      setTimeout(() => { try { s.stop(); } catch { /* ya parado */ } }, 600);
      live.delete(id);
    }
  }
}

let renderT: ReturnType<typeof setTimeout> | undefined;
function applyBackground(levels: Levels) {
  clearTimeout(renderT);
  renderT = setTimeout(() => {
    const rate = 22050;
    const url = URL.createObjectURL(new Blob([wav(mix(levels, LOOP_S * 2, rate), rate) as BlobPart], { type: 'audio/wav' }));
    bg ??= Object.assign(new Audio(), { loop: true });
    const t = bg.currentTime;
    bg.src = url;
    bg.currentTime = t;
    bg.volume = target();
    if (playing) void bg.play().catch(() => {});
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = url;
    mediaSession();
  }, bg ? 300 : 0);
}

function mediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: 'Sonido ambiente', artist: 'Engrama' });
    navigator.mediaSession.setActionHandler('play', () => { if (bg) void bg.play(); playing = true; emit(); });
    navigator.mediaSession.setActionHandler('pause', () => { bg?.pause(); playing = false; emit(); });
    navigator.mediaSession.setActionHandler('stop', () => ambient.stop());
  } catch { /* Media Session incompleta */ }
}

let levelsNow: Levels = {};
export const ambient = {
  get playing() { return playing; },
  get mode() { return mode; },
  supported: () => typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window),
  subscribe(f: () => void) { listeners.add(f); return () => listeners.delete(f); },
  /** Llamar SOLO desde un toque del usuario (Safari exige el gesto para el audio). */
  play(levels: Levels, background: boolean) {
    levelsNow = levels;
    mode = background ? 'background' : 'live';
    playing = true;
    paused = false;
    if (mode === 'live') {
      bg?.pause();
      const c = ensureCtx();
      if (!c) return;
      void c.resume();
      master!.gain.cancelScheduledValues(c.currentTime);
      master!.gain.setValueAtTime(target(), c.currentTime);
      applyLive(levels);
    } else {
      for (const id of [...live.keys()]) applyLive({ ...levels, [id]: 0 });
      // crear el <audio> dentro del gesto
      bg ??= Object.assign(new Audio(), { loop: true });
      void bg.play().catch(() => {});
      applyBackground(levels);
    }
    emit();
  },
  setLevels(levels: Levels) {
    levelsNow = levels;
    if (!playing) return;
    if (mode === 'live' && ctx) applyLive(levels);
    else applyBackground(levels);
  },
  stop() {
    playing = false;
    paused = false;
    if (ctx) applyLive({});
    bg?.pause();
    emit();
  },
  /** Pausa desde el mini reproductor: como detener, pero recuerda que se puede reanudar. */
  pause() {
    if (!playing) return;
    ambient.stop();
    paused = true;
    emit();
  },
  /** Reanudar (desde un toque) con los mismos sonidos y el mismo modo. */
  resume() { if (paused) ambient.play(levelsNow, mode === 'background'); },
  get paused() { return paused; },
  get volume() { return volume; },
  setVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    if (ctx && master) master.gain.setTargetAtTime(target(), ctx.currentTime, 0.05);
    if (bg) bg.volume = target();
    player.setVolume(volume);
    emit();
  },
  /** Desvanecer en `ms` y parar (temporizador de apagado). */
  fadeOut(ms = 5000) {
    if (!playing) return;
    if (mode === 'live' && ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + ms / 1000);
      setTimeout(() => ambient.stop(), ms + 50);
    } else if (bg) {
      // iOS ignora `volume` en <audio>: allí solo se detiene al final
      const a = bg, v0 = a.volume, t0 = Date.now();
      const iv = setInterval(() => { const k = 1 - (Date.now() - t0) / ms; if (k <= 0) { clearInterval(iv); ambient.stop(); a.volume = v0; } else a.volume = Math.max(0, v0 * k); }, 100);
    }
  },
  /** Atenuar (tarjeta con audio o voz) o silenciar (descanso del pomodoro). */
  set(opts: { duck?: boolean; mute?: boolean }) {
    if (opts.duck !== undefined) duckOn = opts.duck;
    if (opts.mute !== undefined) muted = opts.mute;
    if (ctx && master) master.gain.setTargetAtTime(target(), ctx.currentTime, 0.2);
    if (bg) bg.volume = target();
  },
  levels: () => levelsNow,
  /** Para pruebas y diagnóstico: ¿hay contexto de audio y en qué estado? */
  state: (): 'none' | AudioContextState | 'background' => (mode === 'background' && playing ? 'background' : ctx?.state ?? 'none'),
};
if (typeof window !== 'undefined') (window as unknown as { __ambient: typeof ambient }).__ambient = ambient;

/** Reproductor de música propia: lista simple, bucle o aleatorio. */
let music: HTMLAudioElement | null = null;
let queue: { path: string; url: string; title: string }[] = [];
let idx = 0;
let shuffle = false;
let loopAll = true;
const mListeners = new Set<() => void>();
let mVolume = 1;
let ducked = false;
export const player = {
  get current() { return queue[idx] ?? null; },
  get playing() { return !!music && !music.paused; },
  subscribe(f: () => void) { mListeners.add(f); return () => mListeners.delete(f); },
  /** Desde un toque: `urls` ya resueltas (blob:) para cada pista. */
  play(list: { path: string; url: string; title: string }[], start = 0, opts: { shuffle: boolean; loop: boolean }) {
    queue = list;
    shuffle = opts.shuffle;
    loopAll = opts.loop;
    idx = Math.max(0, Math.min(start, list.length - 1));
    music ??= new Audio();
    music.volume = (ducked ? 0.3 : 1) * mVolume;
    music.onended = () => player.next();
    music.onplay = music.onpause = () => mListeners.forEach((f) => f());
    music.src = queue[idx]?.url ?? '';
    void music.play().catch(() => {});
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: queue[idx]?.title ?? '', artist: 'Engrama' });
        navigator.mediaSession.setActionHandler('nexttrack', () => player.next());
        navigator.mediaSession.setActionHandler('previoustrack', () => player.prev());
      } catch { /* ignorar */ }
    }
    mListeners.forEach((f) => f());
  },
  next() {
    if (!queue.length || !music) return;
    if (shuffle) idx = Math.floor(Math.random() * queue.length);
    else if (idx + 1 < queue.length) idx++;
    else if (loopAll) idx = 0;
    else return player.pause();
    music.src = queue[idx]!.url;
    void music.play().catch(() => {});
    mListeners.forEach((f) => f());
  },
  prev() { if (music && queue.length) { idx = (idx - 1 + queue.length) % queue.length; music.src = queue[idx]!.url; void music.play().catch(() => {}); mListeners.forEach((f) => f()); } },
  pause() { music?.pause(); mListeners.forEach((f) => f()); },
  resume() { void music?.play().catch(() => {}); },
  fadeOut(ms = 5000) {
    if (!music || music.paused) return;
    const a = music, v0 = a.volume, t0 = Date.now();
    const iv = setInterval(() => { const k = 1 - (Date.now() - t0) / ms; if (k <= 0) { clearInterval(iv); a.pause(); a.volume = v0; mListeners.forEach((f) => f()); } else a.volume = Math.max(0, v0 * k); }, 100);
  },
  setDuck(on: boolean) { ducked = on; if (music) music.volume = (on ? 0.3 : 1) * mVolume; },
  setVolume(v: number) { mVolume = v; if (music) music.volume = (ducked ? 0.3 : 1) * mVolume; },
};
