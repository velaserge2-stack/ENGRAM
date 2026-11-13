/**
 * Motor de sonido ambiente (Prompt 5 · A).
 *
 * - Primer plano: Web Audio (mezcla en vivo, volumen por sonido, desvanecimiento exacto).
 * - «Seguir sonando con la pantalla bloqueada»: la mezcla se renderiza a un bucle WAV y suena
 *   con un elemento <audio> + Media Session (título y controles en la pantalla bloqueada).
 *   Safari suspende el AudioContext en segundo plano; un <audio> de la página puede seguir.
 * - Nada suena sin un toque: el AudioContext se crea dentro del gesto que pulsa «Reproducir».
 * - Música propia: otro <audio> con lista, bucle y aleatorio (archivos en media/audio/).
 * - Safari (arreglo del reproductor): `navigator.audioSession.type = 'playback'` dentro del gesto,
 *   para que suene con el interruptor de silencio y por el altavoz; el <audio> de la música se
 *   «desbloquea» en el mismo toque (antes de leer los archivos); y un play() rechazado ya no se
 *   esconde: avisa (onAudioError) y deja el botón en «detenido».
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

/** Sesión de audio de Safari 16.4+ (en otros navegadores no existe): reproducción, no «ambiente». */
export function audioSession(): void {
  try {
    const n = navigator as Navigator & { audioSession?: { type: string } };
    if (n.audioSession && n.audioSession.type !== 'playback') n.audioSession.type = 'playback';
  } catch { /* sin sesión de audio */ }
}

/** Errores de reproducción (antes se tragaban con `.catch(() => {})`). */
export interface AudioError { source: 'ambient' | 'music' | 'test'; name: string }
const errListeners = new Set<(e: AudioError) => void>();
export const onAudioError = (f: (e: AudioError) => void) => (errListeners.add(f), () => void errListeners.delete(f));
function failed(source: AudioError['source'], e: unknown) {
  const name = (e as { name?: string } | null)?.name ?? 'Error';
  if (name === 'AbortError') return; // cambiar de pista interrumpe el play() anterior: normal
  errListeners.forEach((f) => f({ source, name }));
}

function ensureCtx(): Ctx | null {
  if (ctx) return ctx;
  const C = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  master = ctx.createGain();
  master.connect(ctx.destination);
  // Safari suspende o «interrumpe» el contexto (bloqueo, llamada, cambio de salida): reanudar
  const wake = () => { if (document.visibilityState === 'visible' && playing && mode === 'live' && ctx && ctx.state !== 'running') void ctx.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', wake);
  ctx.addEventListener?.('statechange', wake);
  navigator.mediaDevices?.addEventListener?.('devicechange', wake);
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
    if (playing) void bg.play().catch((e) => bgFailed(e));
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = url;
    mediaSession();
  }, bg ? 300 : 0);
}

function bgFailed(e: unknown) {
  if ((e as { name?: string } | null)?.name === 'AbortError') return;
  playing = false;
  emit();
  failed('ambient', e);
}

/**
 * Media Session única para los dos motores (teclas multimedia, pantalla bloqueada): reproducir y
 * pausar actúan sobre lo que estaba sonando; anterior/siguiente, sobre la música si la hay.
 */
function mediaSession(title = 'Sonido ambiente') {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Engrama' });
    navigator.mediaSession.setActionHandler('play', () => { if (player.current && !player.playing) player.resume(); if (ambient.paused) ambient.resume(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (player.playing) player.pause(); if (ambient.playing) ambient.pause(); });
    navigator.mediaSession.setActionHandler('stop', () => { ambient.stop(); player.pause(); });
    navigator.mediaSession.setActionHandler('nexttrack', player.current ? () => player.next() : null);
    navigator.mediaSession.setActionHandler('previoustrack', player.current ? () => player.prev() : null);
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
    audioSession();
    levelsNow = levels;
    mode = background ? 'background' : 'live';
    playing = true;
    paused = false;
    if (mode === 'live') {
      bg?.pause();
      const c = ensureCtx();
      if (!c) return;
      void c.resume().catch((e) => { playing = false; emit(); failed('ambient', e); });
      master!.gain.cancelScheduledValues(c.currentTime);
      master!.gain.setValueAtTime(target(), c.currentTime);
      applyLive(levels);
    } else {
      for (const id of [...live.keys()]) applyLive({ ...levels, [id]: 0 });
      // crear el <audio> dentro del gesto
      bg ??= Object.assign(new Audio(), { loop: true });
      void bg.play().catch((e) => bgFailed(e));
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
  /**
   * «Probar sonido» (desde un toque): un tono corto y bajo por la salida actual. Devuelve el estado
   * del contexto tras intentar reanudarlo, para poder explicar por qué no suena.
   */
  async test(): Promise<AudioContextState | 'none'> {
    audioSession();
    const c = ensureCtx();
    if (!c) return 'none';
    const osc = c.createOscillator(), g = c.createGain();
    osc.frequency.value = 660;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.08, c.currentTime + 0.03);
    g.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.42);
    try { await c.resume(); } catch (e) { failed('test', e); }
    return c.state;
  },
  /** Diagnóstico (pruebas): estado del contexto, ganancia del master y del <audio> de fondo. */
  diag: () => ({ state: ctx?.state ?? 'none', master: master?.gain.value ?? null, target: target(), muted, duck: duckOn, bg: bg ? { paused: bg.paused, volume: bg.volume } : null }),
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
let silent: string | null = null;
const musicFailed = (e: unknown) => { if ((e as { name?: string } | null)?.name === 'AbortError') return; mListeners.forEach((f) => f()); failed('music', e); };
export const player = {
  get current() { return queue[idx] ?? null; },
  /** Progreso de la pista (s) para el mini reproductor. */
  get time() { return music ? { at: music.currentTime, dur: Number.isFinite(music.duration) ? music.duration : 0 } : { at: 0, dur: 0 }; },
  /**
   * Llamar SINCRÓNICAMENTE en el toque, antes de leer los archivos: crea el <audio> y lo
   * «desbloquea» con un instante de silencio. Safari permite luego play() en ese mismo elemento
   * aunque ya no estemos dentro del gesto.
   */
  prime() {
    audioSession();
    music ??= new Audio();
    silent ??= URL.createObjectURL(new Blob([wav(new Float32Array(1102), 22050) as BlobPart], { type: 'audio/wav' }));
    music.src = silent;
    void music.play().then(() => { if (music?.src === silent) music.pause(); }, () => { /* lo dirá el play() real */ });
  },
  get playing() { return !!music && !music.paused; },
  subscribe(f: () => void) { mListeners.add(f); return () => mListeners.delete(f); },
  /** Desde un toque: `urls` ya resueltas (blob:) para cada pista. */
  play(list: { path: string; url: string; title: string }[], start = 0, opts: { shuffle: boolean; loop: boolean }) {
    queue = list;
    shuffle = opts.shuffle;
    loopAll = opts.loop;
    idx = Math.max(0, Math.min(start, list.length - 1));
    audioSession();
    music ??= new Audio();
    music.volume = (ducked ? 0.3 : 1) * mVolume;
    music.onended = () => player.next();
    music.onplay = music.onpause = () => mListeners.forEach((f) => f());
    music.src = queue[idx]?.url ?? '';
    void music.play().catch(musicFailed);
    mediaSession(queue[idx]?.title ?? '');
    mListeners.forEach((f) => f());
  },
  next() {
    if (!queue.length || !music) return;
    if (shuffle) idx = Math.floor(Math.random() * queue.length);
    else if (idx + 1 < queue.length) idx++;
    else if (loopAll) idx = 0;
    else return player.pause();
    music.src = queue[idx]!.url;
    void music.play().catch(musicFailed);
    mediaSession(queue[idx]!.title);
    mListeners.forEach((f) => f());
  },
  prev() { if (music && queue.length) { idx = (idx - 1 + queue.length) % queue.length; music.src = queue[idx]!.url; void music.play().catch(musicFailed); mediaSession(queue[idx]!.title); mListeners.forEach((f) => f()); } },
  pause() { music?.pause(); mListeners.forEach((f) => f()); },
  resume() { audioSession(); void music?.play().catch(musicFailed); },
  fadeOut(ms = 5000) {
    if (!music || music.paused) return;
    const a = music, v0 = a.volume, t0 = Date.now();
    const iv = setInterval(() => { const k = 1 - (Date.now() - t0) / ms; if (k <= 0) { clearInterval(iv); a.pause(); a.volume = v0; mListeners.forEach((f) => f()); } else a.volume = Math.max(0, v0 * k); }, 100);
  },
  setDuck(on: boolean) { ducked = on; if (music) music.volume = (on ? 0.3 : 1) * mVolume; },
  setVolume(v: number) { mVolume = v; if (music) music.volume = (ducked ? 0.3 : 1) * mVolume; },
};
if (typeof window !== 'undefined') (window as unknown as { __player: typeof player }).__player = player;
