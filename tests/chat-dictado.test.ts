// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../src/i18n';
import { dictate, dictationMode, getDict, WATCHDOG_MS, type Platform } from '../src/chat/voice';

class Fake {
  static all: Fake[] = [];
  continuous = true; interimResults = false; maxAlternatives = 1; lang = ''; aborted = 0;
  onresult: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; onend: (() => void) | null = null; onspeechstart: (() => void) | null = null;
  constructor() { Fake.all.push(this); }
  start() {} stop() { this.onend?.(); } abort() { this.aborted++; this.onend?.(); }
  say(t: string, f: boolean) { this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: f })] }); }
}
const setUA = (ua: string, touch = 0) => {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
};
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
beforeEach(() => { Fake.all = []; dictate.reset(); setLang('es'); (window as any).webkitSpeechRecognition = Fake; });
afterEach(() => { vi.useRealTimers(); delete (window as any).webkitSpeechRecognition; delete (window as any).matchMedia; setUA('jsdom'); dictate.reset(); });

describe('dictationMode', () => {
  it('matriz', () => {
    const m = (standalone: boolean, hasSpeechRecognition: boolean, platform: Platform) => dictationMode({ standalone, hasSpeechRecognition, platform });
    expect(m(false, true, 'ios')).toBe('speech'); expect(m(false, true, 'mac')).toBe('speech'); expect(m(false, true, 'other')).toBe('speech');
    expect(m(true, true, 'ios')).toBe('system'); expect(m(true, true, 'mac')).toBe('speech');
    for (const p of ['ios', 'mac', 'other'] as Platform[]) for (const s of [true, false]) expect(m(s, false, p)).toBe('system');
  });
});

describe('dictado robusto', () => {
  it('iPadOS en modo standalone: no usa la API, enfoca y ayuda para iOS', () => {
    setUA(IPAD, 5); (window as any).matchMedia = (q: string) => ({ matches: q.includes('standalone') });
    document.body.innerHTML = '<form class="chat-form"><textarea></textarea></form>';
    expect(dictate.start()).toBe(false);
    expect(Fake.all.length).toBe(0);
    expect(getDict().help).toBe('ios'); expect(document.activeElement?.tagName).toBe('TEXTAREA');
  });
  it('Mac de escritorio en pestaña: ayuda mac al caer', () => {
    setUA(IPAD, 0); delete (window as any).webkitSpeechRecognition;
    dictate.start(); expect(getDict().help).toBe('mac');
  });
  it('sin getUserMedia, continuous=false, interim, 1 alternativa', () => {
    const gum = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: gum }, configurable: true });
    expect(dictate.start()).toBe(true);
    const r = Fake.all[0]!;
    expect(gum).not.toHaveBeenCalled(); expect(r.continuous).toBe(false); expect(r.interimResults).toBe(true); expect(r.lang).toBe('es-MX');
  });
  it.each(['not-allowed', 'service-not-allowed', 'audio-capture', 'no-speech'])('error %s → modo sistema con ayuda', (e) => {
    dictate.start(); Fake.all[0]!.onerror!({ error: e });
    expect(getDict().msg).toMatch(/^voz\.err_/); expect(getDict().help).not.toBe(''); expect(getDict().focusN).toBe(1); expect(getDict().state).toBe('error');
  });
  it('aborted: sin ayuda', () => {
    dictate.start(); Fake.all[0]!.onerror!({ error: 'aborted' });
    expect(getDict().help).toBe(''); expect(getDict().state).toBe('idle');
  });
  it('watchdog: sin eventos en 6 s → aborta y cae al sistema', () => {
    vi.useFakeTimers(); dictate.start(); const r = Fake.all[0]!;
    vi.advanceTimersByTime(WATCHDOG_MS - 1); expect(getDict().state).toBe('listening');
    vi.advanceTimersByTime(2);
    expect(r.aborted).toBe(1); expect(getDict().state).toBe('idle'); expect(getDict().msg).toBe('voz3.no_oye'); expect(getDict().help).not.toBe('');
  });
  it('watchdog: un resultado o speechstart lo desarma', () => {
    vi.useFakeTimers(); dictate.start(); Fake.all[0]!.say('hola', false);
    vi.advanceTimersByTime(WATCHDOG_MS * 2); expect(getDict().state).toBe('listening'); expect(getDict().interim).toBe('hola');
    dictate.abort(); dictate.start(); Fake.all[1]!.onspeechstart!();
    vi.advanceTimersByTime(WATCHDOG_MS * 2); expect(getDict().state).toBe('listening');
  });
  it('detener = termina y no dispara el watchdog', () => {
    vi.useFakeTimers(); dictate.start(); dictate.stop();
    vi.advanceTimersByTime(WATCHDOG_MS * 2); expect(getDict().msg).toBe(''); expect(Fake.all[0]!.aborted).toBe(0);
  });
  it('start() que lanza → sistema', () => {
    (window as any).webkitSpeechRecognition = class { start() { throw new Error('x'); } };
    expect(dictate.start()).toBe(false); expect(getDict().help).not.toBe(''); expect(getDict().state).toBe('idle');
    expect(dictate.start()).toBe(false); // no queda `cur` colgado
  });
});
