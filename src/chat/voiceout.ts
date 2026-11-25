// Lectura en voz alta de las respuestas (speechSynthesis; sin red si la voz es local). Feature detection siempre.
import { useEffect, useReducer } from 'preact/hooks';
import { dictLang } from './voice';

export const speechSupported = (): boolean => typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis && typeof (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance !== 'undefined';

/** Markdown + citas → texto para decir: sin símbolos, `[[Nota]]` → «Nota», `[PDF: x p.3]` → «x, página 3». */
export function speechText(md: string): string {
  return md
    .replace(/\[PDF:\s*([^\]\n]+?)\s+p\.?\s*(\d+)\]/gi, '$1, página $2')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[\s>#*\-+]+/gm, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/[*_`~|]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').trim();
}
/** Trozos de ≤ `max` caracteres cortados en frases (Safari corta las locuciones largas). */
export function speechChunks(text: string, max = 180): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of text.match(/[^.!?]+[.!?]*\s*/g) ?? []) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    let r = s;
    while (r.length > max) { const cut = r.lastIndexOf(' ', max); out.push(r.slice(0, cut > 0 ? cut : max).trim()); r = r.slice(cut > 0 ? cut : max); }
    cur += r;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Solo voces LOCALES (`localService`): una voz en la nube enviaría el texto a un servidor. Sin voz local → undefined: se habla con `lang` y la voz por defecto del sistema. */
export function pickVoice<V extends { lang: string; localService?: boolean }>(all: readonly V[], lang: string): V | undefined {
  const l = lang.toLowerCase(), voices = all.filter((v) => v.localService === true);
  return voices.find((v) => v.lang.toLowerCase().replace('_', '-') === l) ?? voices.find((v) => v.lang.toLowerCase().startsWith(l.slice(0, 2)));
}
const voicesNow = (): SpeechSynthesisVoice[] => { try { return speechSynthesis.getVoices(); } catch { return []; } };

let speaking = false, run = 0;
const subs = new Set<() => void>();
const set = (v: boolean) => { speaking = v; subs.forEach((f) => f()); };
export const isSpeaking = (): boolean => speaking;
export function useSpeaking(): boolean {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { subs.add(bump as () => void); return () => void subs.delete(bump as () => void); }, []);
  return speaking;
}
export function stopSpeak(): void {
  run++;
  try { if (speechSupported()) speechSynthesis.cancel(); } catch { /* nada que cancelar */ }
  set(false);
}
export type SpeakFail = 'blocked' | 'novoices' | 'error';
/** Llamar SÍNCRONO dentro del toque (iOS ignora `speak` tras un await). Devuelve si empezó; `onEnd(true)` = terminó sola, `onEnd(false)` = la cortaron o falló (`onFail` da la causa). */
export function speak(md: string, onEnd?: (done: boolean) => void, onFail?: (c: SpeakFail) => void): boolean {
  const parts = speechChunks(speechText(md));
  if (!speechSupported() || !parts.length) return false;
  const lang = dictLang(), me = ++run; // cancel() solo si hay algo sonando: iOS a veces ignora un speak() pegado a cancel()
  try { if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); } catch { /* nada que cancelar */ }
  const fail = (c: SpeakFail) => { if (me !== run) return; set(false); onFail?.(c); onEnd?.(false); };
  const next = (i: number) => {
    if (me !== run) return onEnd?.(false);
    if (i >= parts.length) { set(false); return onEnd?.(true); }
    const u = new SpeechSynthesisUtterance(parts[i]);
    u.lang = lang;
    const v = pickVoice(voicesNow(), lang); // se reevalúa por trozo: las voces de iOS cargan tarde
    if (v) u.voice = v;
    u.onend = () => next(i + 1);
    u.onerror = (e) => {
      const c = (e as { error?: string }).error;
      if (c === 'canceled' || c === 'interrupted') return; // lo causa nuestro propio cancel()
      fail(c === 'not-allowed' ? 'blocked' : voicesNow().length ? 'error' : 'novoices');
    };
    speechSynthesis.speak(u);
  };
  set(true);
  try { speechSynthesis.resume(); } catch { /* sin pausa que reanudar */ }
  next(0);
  return true;
}
