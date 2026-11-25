import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickVoice, speak, speechChunks, speechText, stopSpeak, isSpeaking } from '../src/chat/voiceout';

type U = { text: string; lang?: string; voice?: unknown; onend?: () => void; onerror?: (e: unknown) => void };
let spoken: U[], calls: string[], voices: unknown[], speaking: boolean;
const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  spoken = []; calls = []; voices = []; speaking = false;
  g.SpeechSynthesisUtterance = class { constructor(public text: string) {} } as unknown;
  g.speechSynthesis = {
    getVoices: () => voices, resume: () => calls.push('resume'), get speaking() { return speaking; }, pending: false,
    cancel: () => calls.push('cancel'), speak: (u: U) => { calls.push('speak'); spoken.push(u); speaking = true; },
  };
});
afterEach(() => { stopSpeak(); delete g.speechSynthesis; delete g.SpeechSynthesisUtterance; });

const at = (i: number): U => spoken[i] as U;
const v = (lang: string, localService: boolean) => ({ lang, localService, name: lang });

describe('speechText', () => {
  it('quita markdown, citas, enlaces y emojis', () => {
    const t = speechText('# Título\n**Hola** [[Nota|alias]] [PDF: guía.pdf p.3] ver [web](https://x.io) https://y.io 😀 `code`');
    expect(t).toContain('Hola'); expect(t).toContain('Nota'); expect(t).toContain('guía.pdf, página 3'); expect(t).toContain('ver web');
    expect(t).not.toMatch(/[*#\[\]`😀]|https?:/);
  });
});
describe('speechChunks', () => {
  it('trozos ≤ 200', () => {
    const c = speechChunks('Frase uno. '.repeat(60) + 'x'.repeat(500), 180);
    expect(c.length).toBeGreaterThan(3); expect(c.every((s) => s.length <= 180)).toBe(true);
  });
});
describe('pickVoice', () => {
  it('ignora remotas y prefiere es-MX', () => {
    expect(pickVoice([v('es-ES', false)], 'es-MX')).toBeUndefined();
    expect(pickVoice([v('es-ES', true), v('es-MX', true)], 'es-MX')?.lang).toBe('es-MX');
    expect(pickVoice([v('es-ES', true)], 'es-MX')?.lang).toBe('es-ES');
  });
});
describe('speak', () => {
  it('sin voces: habla con lang y sin voice', () => {
    expect(speak('Hola mundo.')).toBe(true);
    expect(spoken).toHaveLength(1); expect(at(0).lang).toBe('es-MX'); expect(at(0).voice).toBeUndefined();
    expect(isSpeaking()).toBe(true);
  });
  it('solo voces remotas: sin voice', () => {
    voices = [v('es-MX', false)];
    speak('Hola.'); expect(at(0).voice).toBeUndefined();
  });
  it('voz local es-MX: se usa', () => {
    voices = [v('en-US', true), v('es-MX', true)];
    speak('Hola.'); expect((at(0).voice as { lang: string }).lang).toBe('es-MX');
  });
  it('cola por frases y resume antes del primer speak', () => {
    speak('Uno. Dos. ' + 'palabra '.repeat(60) + '.');
    expect(calls[0]).toBe('resume'); expect(spoken).toHaveLength(1);
    at(0).onend!(); expect(spoken).toHaveLength(2);
  });
  it('cancel solo si algo suena', () => {
    speak('Hola.'); expect(calls).not.toContain('cancel');
    speak('Otra.'); expect(calls).toContain('cancel');
  });
  it('termina: onEnd(true) y botón libre', () => {
    let r: boolean | undefined; speak('Hola.', (d) => { r = d; });
    at(0).onend!(); expect(r).toBe(true); expect(isSpeaking()).toBe(false);
  });
  it('Detener corta ya', () => {
    let r: boolean | undefined; speak('Uno. Dos.', (d) => { r = d; });
    stopSpeak(); expect(calls).toContain('cancel'); expect(isSpeaking()).toBe(false);
    at(0).onend!(); expect(r).toBe(false); expect(spoken).toHaveLength(1);
  });
  it('error: avisa con causa; canceled se ignora', () => {
    let c: string | undefined; speak('Hola.', undefined, (x) => { c = x; });
    at(0).onerror!({ error: 'canceled' }); expect(c).toBeUndefined(); expect(isSpeaking()).toBe(true);
    at(0).onerror!({ error: 'not-allowed' }); expect(c).toBe('blocked'); expect(isSpeaking()).toBe(false);
    speak('Hola.', undefined, (x) => { c = x; }); at(1).onerror!({ error: 'synthesis-failed' }); expect(c).toBe('novoices');
  });
});
