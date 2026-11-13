// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** AudioContext y Audio falsos: lo justo para el motor (sin sonido real). */
class FakeParam { value = 1; setTargetAtTime(v: number) { this.value = v; } setValueAtTime(v: number) { this.value = v; } cancelScheduledValues() {} linearRampToValueAtTime(v: number) { this.value = v; } }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam(); buffer: unknown = null; loop = false; connect(n: unknown) { return n; } start() {} stop() {} }
let ctxs: FakeCtx[] = [];
class FakeCtx extends EventTarget {
  state: AudioContextState = 'suspended';
  sampleRate = 8000;
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  constructor() { super(); ctxs.push(this); }
  createGain() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBuffer(_c: number, n: number) { return { copyToChannel() {}, length: n }; }
}
let reject: string | null = null;
class FakeAudio { src = ''; paused = true; volume = 1; loop = false; currentTime = 0; duration = NaN; onended = null; onplay = null; onpause = null;
  play() { if (reject) return Promise.reject(Object.assign(new Error('x'), { name: reject })); this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; } }

beforeEach(() => {
  vi.resetModules();
  ctxs = [];
  reject = null;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudio;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
});

describe('motor de sonido (arreglo del reproductor)', () => {
  it('target(): silencio y atenuación no se quedan pegados; volumen general', async () => {
    const { ambient } = await import('../src/lib/ambient');
    ambient.play({ rain: 0.5 }, false);
    expect(ambient.diag().master).toBe(1);
    ambient.set({ mute: true });
    expect(ambient.diag().target).toBe(0);
    ambient.set({ mute: false, duck: true });
    expect(ambient.diag().target).toBe(0.25);
    ambient.setVolume(0.5);
    expect(ambient.diag().target).toBe(0.125);
    ambient.set({ duck: false });
    expect(ambient.diag().target).toBe(0.5);
    expect(ambient.diag().master).toBe(0.5);
  });
  it('el contexto suspendido o interrumpido se reanuda (statechange, visibilidad)', async () => {
    const { ambient } = await import('../src/lib/ambient');
    ambient.play({ rain: 0.5 }, false);
    const c = ctxs[0]!;
    await Promise.resolve();
    expect(c.resume).toHaveBeenCalledTimes(1);
    c.state = 'interrupted' as AudioContextState;
    c.dispatchEvent(new Event('statechange'));
    expect(c.resume).toHaveBeenCalledTimes(2);
    ambient.stop();
    c.state = 'suspended';
    c.dispatchEvent(new Event('statechange'));
    expect(c.resume).toHaveBeenCalledTimes(2); // detenido: no se reanuda solo
  });
  it('play() rechazado: aviso con la causa y estado «detenido» (ambiente en segundo plano y música)', async () => {
    const { ambient, onAudioError, player } = await import('../src/lib/ambient');
    const errs: string[] = [];
    onAudioError((e) => errs.push(`${e.source}:${e.name}`));
    reject = 'NotAllowedError';
    ambient.play({ rain: 0.5 }, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(ambient.playing).toBe(false);
    player.play([{ path: 'a.mp3', url: 'blob:a', title: 'A' }], 0, { shuffle: false, loop: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(player.playing).toBe(false);
    expect(errs).toEqual(['ambient:NotAllowedError', 'music:NotAllowedError']);
    reject = 'AbortError'; // cambiar de pista: no es un error para el usuario
    player.next();
    await new Promise((r) => setTimeout(r, 0));
    expect(errs.length).toBe(2);
  });
  it('audioSession: «playback» al reproducir (Safari), y nada si no existe', async () => {
    const { ambient, player } = await import('../src/lib/ambient');
    const session = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
    player.prime();
    expect(session.type).toBe('playback');
    session.type = 'auto';
    ambient.play({ rain: 0.5 }, false);
    expect(session.type).toBe('playback');
    delete (navigator as unknown as { audioSession?: unknown }).audioSession;
    expect(() => ambient.play({ rain: 0.5 }, false)).not.toThrow();
  });
});
