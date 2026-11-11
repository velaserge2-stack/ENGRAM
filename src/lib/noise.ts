/**
 * Sonidos generados en el dispositivo (Prompt 5 · A): sin archivos ni derechos de autor.
 * Cada generador devuelve un bucle mono de `seconds` segundos en [-1, 1], con un fundido
 * cruzado en las puntas para que el bucle no haga «clic». PRNG con semilla: reproducible.
 */
export type SoundId = 'white' | 'pink' | 'brown' | 'rain' | 'wind' | 'waves' | 'fan';
export const SOUNDS: SoundId[] = ['white', 'pink', 'brown', 'rain', 'wind', 'waves', 'fan'];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), (s / 4294967296) * 2 - 1);
}

const white = (n: number, r: () => number) => Float32Array.from({ length: n }, r);

function pink(n: number, r: () => number): Float32Array {
  // Paul Kellet (versión económica)
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return out;
}

function brown(n: number, r: () => number): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * r()) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/** Filtro paso bajo de un polo (suaviza ruido: viento, ventilador). */
function lowpass(x: Float32Array, a: number): Float32Array {
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) out[i] = y += a * (x[i]! - y);
  return out;
}

function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const v of x) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  const k = m > 0 ? peak / m : 0;
  for (let i = 0; i < x.length; i++) x[i] = Number.isFinite(x[i]!) ? x[i]! * k : 0;
  return x;
}

/** Fundido cruzado de la cola sobre la cabeza: el bucle empalma sin salto. */
function loopable(x: Float32Array, fade: number): Float32Array {
  const f = Math.min(fade, Math.floor(x.length / 4));
  const out = x.slice(0, x.length - f);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = x[i]! * t + x[x.length - f + i]! * (1 - t);
  }
  return out;
}

export function generate(id: SoundId, seconds: number, rate: number, seed = 7): Float32Array {
  const n = Math.max(1, Math.round(seconds * rate));
  const r = rng(seed + SOUNDS.indexOf(id) * 101);
  let x: Float32Array;
  switch (id) {
    case 'white': x = white(n, r).map((v) => v * 0.5); break;
    case 'pink': x = pink(n, r); break;
    case 'brown': x = brown(n, r); break;
    case 'rain': {
      // lluvia: ruido rosa suave + gotas (impulsos que decaen rápido)
      const base = lowpass(pink(n, r), 0.35);
      for (let i = 0; i < n; i++) base[i] = base[i]! * 0.6;
      const drops = Math.round(seconds * 40);
      for (let k = 0; k < drops; k++) {
        const at = Math.floor(((r() + 1) / 2) * (n - 1));
        const amp = 0.3 + 0.4 * Math.abs(r());
        for (let j = 0; j < Math.min(rate * 0.02, n - at); j++) base[at + j] = base[at + j]! + amp * r() * Math.exp(-j / (rate * 0.003));
      }
      x = base;
      break;
    }
    case 'wind': {
      // viento: marrón filtrado con ráfagas lentas
      const b = lowpass(brown(n, r), 0.08);
      for (let i = 0; i < n; i++) b[i] = b[i]! * (0.55 + 0.45 * Math.sin((2 * Math.PI * i) / (rate * 7.3)) * Math.sin((2 * Math.PI * i) / (rate * 2.9)));
      x = b;
      break;
    }
    case 'waves': {
      // olas: rosa con una envolvente de ~8 s (subida lenta, rompiente, retirada)
      const p = lowpass(pink(n, r), 0.25);
      const period = rate * 8;
      for (let i = 0; i < n; i++) { const ph = (i % period) / period; p[i] = p[i]! * (0.15 + 0.85 * Math.pow(Math.sin(Math.PI * ph), 3)); }
      x = p;
      break;
    }
    case 'fan': {
      // ventilador: marrón muy filtrado + zumbido suave del motor
      const b = lowpass(brown(n, r), 0.15);
      for (let i = 0; i < n; i++) b[i] = b[i]! + 0.06 * Math.sin((2 * Math.PI * 110 * i) / rate);
      x = b;
      break;
    }
  }
  return normalize(loopable(x, Math.round(rate * 0.25)));
}

/** Ganancia durante el desvanecimiento: 1 hasta `endAt − fadeMs`, luego lineal a 0. */
export function fadeGain(now: number, endAt: number | null, fadeMs = 5000): number {
  if (endAt === null) return 1;
  if (now >= endAt) return 0;
  return Math.min(1, Math.max(0, (endAt - now) / fadeMs));
}

/** Hora de apagado: minutos desde ahora o el final del enfoque del pomodoro en marcha. */
export function sleepAt(now: number, choice: 0 | 15 | 30 | 60 | 'pomodoro', pomo: { running: boolean; phase: string; endAt: number | null }): number | null {
  if (choice === 0) return null;
  if (choice === 'pomodoro') return pomo.running && pomo.phase === 'work' && pomo.endAt ? pomo.endAt : null;
  return now + choice * 60_000;
}

/** WAV PCM de 16 bits (para reproducir la mezcla con <audio> y seguir sonando en segundo plano). */
export function wav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  return out;
}

/** Mezcla de varios sonidos con su volumen (0–1), recortada a [-1, 1]. */
export function mix(levels: Partial<Record<SoundId, number>>, seconds: number, rate: number): Float32Array {
  let out: Float32Array | null = null;
  for (const id of SOUNDS) {
    const g = levels[id] ?? 0;
    if (!(g > 0)) continue;
    const x = generate(id, seconds, rate);
    out ??= new Float32Array(x.length);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + (x[i] ?? 0) * g;
  }
  if (!out) return new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]!));
  return out;
}
