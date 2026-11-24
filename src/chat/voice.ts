// Dictado: envoltorio del reconocimiento de voz DEL SISTEMA (Safari/iPadOS/macOS). El audio no pasa por Engrama ni por la CSP;
// aquí solo llega texto. Nada se guarda. start() solo desde un gesto. El texto va al campo del chat y nunca se envía solo.
import { useEffect, useReducer } from 'preact/hooks';
import { getLang } from '../i18n';

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Ctor = new () => Rec;

const ctor = (): Ctor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as Record<string, Ctor | undefined>;
  return ('SpeechRecognition' in window ? w.SpeechRecognition : undefined) ?? ('webkitSpeechRecognition' in window ? w.webkitSpeechRecognition : undefined);
};
export const dictationSupported = (): boolean => !!ctor();

export type DictState = 'idle' | 'listening' | 'error';
export type DictCode = 'denied' | 'nospeech' | 'capture' | 'network' | 'aborted' | 'other';
export const dictCode = (e: string): DictCode =>
  e === 'not-allowed' || e === 'service-not-allowed' ? 'denied' : e === 'no-speech' ? 'nospeech' : e === 'audio-capture' ? 'capture' : e === 'network' ? 'network' : e === 'aborted' ? 'aborted' : 'other';
/** es→es-MX, en→en-US, fr→fr-FR (el pseudoidioma xx usa español). */
export const dictLang = (l: string = getLang()): string => (l === 'en' ? 'en-US' : l === 'fr' ? 'fr-FR' : 'es-MX');

export type DictationOpts = { lang: string; onInterim: (t: string) => void; onFinal: (t: string) => void; onState: (s: DictState) => void; onError: (c: DictCode) => void };
/** Una sesión de reconocimiento. `continuous=false`, con parciales. Sin reintentos. */
export function createDictation(o: DictationOpts) {
  const C = ctor();
  if (!C) throw new Error('dictation unsupported');
  const r = new C();
  r.lang = o.lang; r.continuous = false; r.interimResults = true;
  let dead = false;
  const end = () => { if (dead) return; dead = true; r.onresult = r.onerror = r.onend = null; };
  r.onresult = (e) => {
    let fin = '', int = '';
    for (let i = 0; i < e.results.length; i++) { const x = e.results[i]!; (x.isFinal ? (fin += x[0]!.transcript) : (int += x[0]!.transcript)); }
    if (fin) o.onFinal(fin.trim());
    o.onInterim(fin ? '' : int.trim());
  };
  r.onerror = (e) => { const c = dictCode(e.error); end(); o.onInterim(''); o.onState(c === 'aborted' ? 'idle' : 'error'); o.onError(c); };
  r.onend = () => { if (dead) return; end(); o.onInterim(''); o.onState('idle'); };
  return {
    start: () => { r.start(); o.onState('listening'); },
    stop: () => { try { r.stop(); } catch { /* ya parado */ } },
    abort: () => { try { r.abort(); } catch { /* ya parado */ } if (!dead) { end(); o.onInterim(''); o.onState('idle'); } },
  };
}

// ── Sesión única compartida por la barra y el panel ──
export type Dict = { state: DictState; id: number; text: string; interim: string; msg: string; focusN: number };
let d: Dict = { state: 'idle', id: 0, text: '', interim: '', msg: '', focusN: 0 };
let cur: ReturnType<typeof createDictation> | null = null, timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const set = (p: Partial<Dict>) => { d = { ...d, ...p }; subs.forEach((f) => f()); };
export const getDict = (): Dict => d;
export const subscribeDict = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useDict(): Dict {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeDict(bump as () => void), []);
  return d;
}
const say = (msg: string) => { clearTimeout(timer); set({ msg }); if (msg) timer = setTimeout(() => set({ msg: '' }), 6000); };

export const dictate = {
  /** Solo desde un gesto. Sin soporte: pide enfocar el campo y avisa. Devuelve si empezó. */
  start(): boolean {
    if (cur) return false;
    if (!dictationSupported()) { set({ focusN: d.focusN + 1 }); say('voz.sin_soporte'); return false; }
    say('');
    try {
      const me = createDictation({
        lang: dictLang(),
        onInterim: (t) => { if (cur === me) set({ interim: t }); },
        onFinal: (t) => { if (cur === me && t) set({ text: d.text ? `${d.text} ${t}` : t }); },
        onState: (s) => { if (cur !== me) return; if (s !== 'listening') cur = null; set({ state: s }); },
        onError: (c) => { if (c !== 'aborted') say(`voz.err_${c}`); },
      });
      cur = me;
      set({ state: 'listening', id: d.id + 1, text: '', interim: '' });
      me.start();
      return true;
    } catch { cur = null; set({ state: 'error' }); say('voz.err_other'); return false; }
  },
  stop() { cur?.stop(); },
  abort() { cur?.abort(); },
  /** Solo pruebas. */
  reset() { cur?.abort(); cur = null; clearTimeout(timer); d = { state: 'idle', id: 0, text: '', interim: '', msg: '', focusN: 0 }; },
};
/** Une el texto previo del campo, el definitivo y el provisional con un espacio. */
export const joinDictation = (...p: string[]) => p.filter((s) => s.trim()).join(' ');
