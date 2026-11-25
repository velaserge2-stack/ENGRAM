// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { createDictation, dictate, dictCode, dictLang, dictationSupported, getDict, joinDictation } from '../src/chat/voice';

class Fake {
  static all: Fake[] = [];
  lang = ''; continuous = true; interimResults = false; started = 0; stopped = 0; aborted = 0;
  onresult: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; onend: (() => void) | null = null;
  constructor() { Fake.all.push(this); }
  start() { this.started++; } stop() { this.stopped++; this.onend?.(); } abort() { this.aborted++; this.onend?.(); }
  say(parts: [string, boolean][]) { this.onresult?.({ results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) }); }
}
const install = () => { (window as any).webkitSpeechRecognition = Fake; };
beforeEach(() => { Fake.all = []; dictate.reset(); setLang('es'); });
afterEach(() => { delete (window as any).webkitSpeechRecognition; delete (window as any).SpeechRecognition; dictate.reset(); });

describe('dictado', () => {
  it('detecta soporte por feature detection', () => {
    expect(dictationSupported()).toBe(false);
    install(); expect(dictationSupported()).toBe(true);
  });
  it('idioma por la lengua de la app', () => {
    expect([dictLang('es'), dictLang('en'), dictLang('fr'), dictLang('xx')]).toEqual(['es-MX', 'en-US', 'fr-FR', 'es-MX']);
    install(); setLang('en'); dictate.start();
    expect(Fake.all[0]!.lang).toBe('en-US');
    expect(Fake.all[0]!.continuous).toBe(false); expect(Fake.all[0]!.interimResults).toBe(true);
  });
  it('interino → definitivo, y se añade con espacio', () => {
    install(); dictate.start();
    const r = Fake.all[0]!;
    r.say([['hola mu', false]]);
    expect(getDict().interim).toBe('hola mu'); expect(getDict().text).toBe('');
    r.say([['hola mundo', true]]);
    expect(getDict().text).toBe('hola mundo'); expect(getDict().interim).toBe('');
    expect(joinDictation('antes', getDict().text, getDict().interim)).toBe('antes hola mundo');
  });
  it('una sola sesión a la vez', () => {
    install(); expect(dictate.start()).toBe(true); expect(dictate.start()).toBe(false);
    expect(Fake.all.length).toBe(1); expect(Fake.all[0]!.started).toBe(1);
  });
  it('stop y abort terminan y limpian listeners', () => {
    install(); dictate.start(); const r = Fake.all[0]!;
    dictate.stop(); expect(r.stopped).toBe(1); expect(getDict().state).toBe('idle'); expect(r.onresult).toBeNull();
    dictate.start(); const r2 = Fake.all[1]!;
    dictate.abort(); expect(r2.aborted).toBe(1); expect(getDict().state).toBe('idle'); expect(r2.onend).toBeNull();
    expect(dictate.start()).toBe(true); // se puede empezar de nuevo
  });
  it('mapa de errores', () => {
    expect(['not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture', 'network', 'aborted', 'x'].map(dictCode))
      .toEqual(['denied', 'denied', 'nospeech', 'capture', 'network', 'aborted', 'other']);
    install(); dictate.start(); Fake.all[0]!.onerror!({ error: 'not-allowed' });
    expect(getDict().state).toBe('error'); expect(getDict().msg).toBe('voz.err_denied');
    expect(getDict().help).not.toBe(''); expect(getDict().focusN).toBe(1); // cae al dictado del sistema
    expect(dictate.start()).toBe(true);
  });
  it('sin soporte: avisa y pide enfocar el campo', () => {
    expect(dictate.start()).toBe(false);
    expect(getDict().help).not.toBe(''); expect(getDict().focusN).toBe(1);
  });
  it('createDictation sin soporte lanza', () => {
    expect(() => createDictation({ lang: 'es-MX', onInterim() {}, onFinal() {}, onState() {}, onError() {} })).toThrow();
  });
});
