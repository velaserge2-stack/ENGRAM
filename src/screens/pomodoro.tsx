import { BarChart3, Pause, Play, RotateCcw, SkipForward } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dayKey } from '../lib/days';
import { duration, fmt, initial, pause, PHASE_LABEL, type PomoState, parseSessions, remaining, reset, skip, start, tick } from '../lib/pomodoro';
import type { Settings } from '../lib/settings';
import { type PomoCtl, useApp } from '../state';
import { Ring } from '../ui/kit';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';

const STATE_PATH = '.app/pomodoro-state.json';
export const POMO_LOG = '.app/pomodoro.jsonl';

let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    void audio.resume();
  } catch {
    audio = null;
  }
}
function chime() {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [f, d] of [[880, 0], [660, 0.25]] as const) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
    o.connect(g).connect(audio.destination);
    o.start(t + d);
    o.stop(t + d + 0.55);
  }
}

type WakeLock = { release(): Promise<void> };

/** Controlador global del pomodoro: el tiempo vive en `endAt`, persistido en la bóveda. */
export function usePomodoro(vault: VaultAdapter, s: Settings, toast: (m: string) => void, onSession: () => void): PomoCtl {
  const cfg = s.pomo;
  const [state, setState] = useState<PomoState>(() => initial(cfg));
  const [now, setNow] = useState(Date.now());
  const [today, setToday] = useState(0);
  const loaded = useRef(false);
  const wake = useRef<WakeLock | null>(null);

  const countToday = async () => {
    const k = dayKey(Date.now(), s.timeZone, s.dayStartHour);
    setToday(parseSessions(await readTextOr(vault, POMO_LOG, '')).filter((x) => x.completed && dayKey(x.ts, s.timeZone, s.dayStartHour) === k).length);
  };

  useEffect(() => {
    void readTextOr(vault, STATE_PATH, '').then((t) => {
      try {
        if (t) setState({ ...initial(cfg), ...(JSON.parse(t) as PomoState) });
      } catch {
        /* estado dañado: empezar de cero */
      }
      loaded.current = true;
    });
    void countToday();
  }, []);

  const commit = (next: PomoState) => {
    setState(next);
    void vault.write(STATE_PATH, JSON.stringify(next));
  };

  const log = async (session: { ts: number; end: number; minutes: number; label: string; completed: boolean } | null) => {
    if (!session || session.minutes < 0.5) return;
    const prev = await readTextOr(vault, POMO_LOG, '');
    await vault.write(POMO_LOG, prev + JSON.stringify(session) + '\n');
    void countToday();
    onSession();
  };

  // Avance: al volver a primer plano y en el momento exacto de endAt
  useEffect(() => {
    const step = () => {
      const t = Date.now();
      setNow(t);
      const r = tick(state, cfg, t);
      if (r.finished) {
        commit(r.state);
        void log(r.session);
        if (cfg.sound) chime();
        toast(r.finished === 'work' ? 'Pomodoro terminado: toma un descanso' : 'Descanso terminado');
      }
    };
    const onVis = () => document.visibilityState === 'visible' && step();
    document.addEventListener('visibilitychange', onVis);
    // solo para refrescar la pantalla; la cuenta real es endAt − ahora
    const iv = state.running ? setInterval(step, 1000) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
    };
  }, [state, cfg]);

  // Mantener la pantalla encendida mientras corre (Screen Wake Lock, si existe)
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLock> } };
    if (state.running && nav.wakeLock) nav.wakeLock.request('screen').then((w) => (wake.current = w), () => {});
    else if (!state.running && wake.current) void wake.current.release().then(() => (wake.current = null));
  }, [state.running]);

  return {
    state,
    now,
    today,
    start(label) {
      unlockAudio(); // el sonido solo puede iniciarse tras un gesto
      const t = Date.now();
      setNow(t);
      commit(start(label !== undefined ? { ...state, label } : state, t));
    },
    pause: () => commit(pause(state, Date.now())),
    reset: () => commit(reset(state, cfg)),
    skip() {
      const r = skip(state, cfg, Date.now());
      commit(r.state);
      void log(r.session);
    },
    setLabel: (l) => commit({ ...state, label: l }),
  };
}

export function PomodoroPanel(props: { compact?: boolean }) {
  const app = useApp();
  const p = app.pomo;
  const cfg = app.settings.pomo;
  const rem = remaining(p.state, p.now);
  const total = duration(cfg, p.state.phase);
  const [showStats, setShowStats] = useState(false);
  return (
    <section class="pomo glass panel" aria-label="Pomodoro">
      {!props.compact && <Ring value={1 - rem / total} size={120} label="Progreso" text=" " class="prog" />}
      <div class="time" style={props.compact ? undefined : { marginTop: '-82px', marginBottom: '40px' }} aria-live="off">{fmt(rem)}</div>
      <div class="phase">{PHASE_LABEL[p.state.phase]}{p.state.label ? ` · ${p.state.label}` : ''}</div>
      <div class="ctrls">
        <button type="button" class={`btn round${p.state.running ? '' : ' primary'}`} onClick={() => (p.state.running ? p.pause() : p.start())} aria-label={p.state.running ? 'Pausar' : 'Iniciar'}>
          {p.state.running ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button type="button" class="btn round" onClick={p.reset} aria-label="Reiniciar"><RotateCcw size={20} /></button>
        <button type="button" class="btn round" onClick={p.skip} aria-label="Saltar fase"><SkipForward size={20} /></button>
        <button type="button" class="btn round" onClick={() => setShowStats(!showStats)} aria-label="Estadísticas de enfoque" aria-pressed={showStats}><BarChart3 size={20} /></button>
      </div>
      <p class="foot center">Hoy: {p.today} · Estudio: {cfg.work} min · Descanso: {cfg.short} min</p>
      {showStats && <FocusStats />}
      {!props.compact && (
        <input class="input wide" style={{ marginTop: '10px' }} placeholder="¿Qué estudias? (materia, mazo o examen)" value={p.state.label} onChange={(e) => p.setLabel((e.target as HTMLInputElement).value)} aria-label="Etiqueta del pomodoro" />
      )}
    </section>
  );
}

function FocusStats() {
  const app = useApp();
  const [rows, setRows] = useState<[string, number][]>([]);
  useEffect(() => {
    void readTextOr(app.vault, POMO_LOG, '').then((t) => {
      const by = new Map<string, number>();
      for (const s of parseSessions(t)) by.set(s.label || 'Sin etiqueta', (by.get(s.label || 'Sin etiqueta') ?? 0) + s.minutes);
      setRows([...by].sort((a, b) => b[1] - a[1]).slice(0, 6));
    });
  }, [app.pomo.today]);
  return (
    <div class="stack-s" style={{ marginTop: '8px' }}>
      {rows.length ? rows.map(([k, m]) => (
        <div class="kv"><span class="k">{k}</span><span class="v">{Math.round(m)} min</span></div>
      )) : <p class="foot center">Aún no hay sesiones registradas.</p>}
    </div>
  );
}
