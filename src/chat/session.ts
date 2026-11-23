// Sesión en streaming (contrato §6). Una petición a la vez; rotación solo ante quota/auth y antes de recibir texto.
import type { ModelMessage, ToolSet } from 'ai';
import { classify, decide, redact, type Kind } from './errors';
import { loadKeys, markKey, pickKey, saveKeys } from './keys';
import { loadCore, loadModel } from './providers';
import { fromHeaders, loadUsage, record, saveUsage, setHdr } from './usage';

export const MAX_WAIT_MS = 60_000;
export const TIMEOUT_MS = 120_000, MAX_OUT = 2048;
const DEFAULT_WAIT_MS = 5_000;

export interface TurnOpts {
  messages: ModelMessage[];
  system?: string;
  tools?: ToolSet;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  /** Códigos para la interfaz: 'rotated' (cambió de clave) | 'waiting' (429 por minuto). */
  /** Una herramienta fue llamada; la interfaz lo muestra hasta que llega texto. */
  onTool?: (name: string) => void;
  onStatus?: (s: { code: 'rotated' | 'waiting'; alias: string; waitMs?: number }) => void;
  /** Solo pruebas. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export type TurnResult =
  | { ok: true; text: string; alias: string; rotated: boolean; tokens: number }
  | { ok: false; code: 'busy' | 'nokey' | Kind; message: string; rotated: boolean };

let inflight = false;
export const busy = (): boolean => inflight;

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res) => {
    if (signal?.aborted) return res();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); signal?.removeEventListener('abort', done); res(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function runTurn(o: TurnOpts): Promise<TurnResult> {
  if (inflight) return { ok: false, code: 'busy', message: 'busy', rotated: false };
  inflight = true;
  try { return await run(o); } finally { inflight = false; }
}

async function run(o: TurnOpts): Promise<TurnResult> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? sleepAbortable;
  let store = loadKeys();
  const skip = new Set<string>();
  let rotated = false, waited = false;
  let last: { code: Kind; message: string } | null = null;
  const fail = (code: 'nokey' | Kind, message: string): TurnResult => ({ ok: false, code, message: redact(message, store.keys.map((k) => k.key)), rotated });

  for (;;) {
    const k = pickKey(store.keys, now(), skip);
    if (!k) return last ? fail(last.code, last.message) : fail('nokey', 'nokey');
    let text = '', err: unknown, stepped = false, timedOut = false;
    // un AbortController por intento: Detener o 120 s sin señales del servidor lo cortan
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (o.signal?.aborted) ac.abort(); else o.signal?.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeoutMs ?? TIMEOUT_MS); };
    try {
      arm();
      const [core, model] = await Promise.all([loadCore(), loadModel(k.provider, k.key, o.fetch)]);
      const r = core.streamText({
        model, system: o.system, messages: o.messages, tools: o.tools,
        stopWhen: core.stepCountIs(5), maxRetries: 0, maxOutputTokens: MAX_OUT, abortSignal: ac.signal,
        onError: ({ error }) => { err = err ?? error; },
      });
      for await (const part of r.fullStream) {
        arm();
        if (part.type === 'text-delta') { text += part.text; o.onText?.(part.text); }
        else if (part.type === 'tool-call') { stepped = true; o.onTool?.(part.toolName); }
        else if (part.type === 'tool-result') stepped = true;
        else if (part.type === 'error') err = err ?? part.error;
      }
      if (!err && !timedOut && !o.signal?.aborted) {
        let tokens = 0, headers: Record<string, string> | undefined;
        try { tokens = (await r.totalUsage).totalTokens ?? 0; } catch { /* sin cifra */ }
        try { headers = (await (r as unknown as { response: PromiseLike<{ headers?: Record<string, string> }> }).response).headers; } catch { /* sin cabeceras */ }
        const t = now();
        saveUsage(setHdr(record(loadUsage(), k.id, tokens, t), k.id, fromHeaders(k.provider, headers, t)));
        return { ok: true, text, alias: k.alias, rotated, tokens };
      }
    } catch (e) { err = e; } finally { clearTimeout(timer); o.signal?.removeEventListener('abort', onAbort); }

    const c = o.signal?.aborted ? { kind: 'aborted' as Kind } : timedOut ? { kind: 'network' as Kind } : classify(k.provider, err, now());
    const message = String((err as { message?: string } | undefined)?.message ?? c.kind);
    last = { code: c.kind, message };
    const d = decide(c.kind);
    if (text || stepped || d === 'fail') return fail(c.kind, message);
    if (d === 'rotate') {
      // se relee: una clave borrada u «Olvidada» durante el turno no debe reaparecer. 403 puede ser región/permisos: se pausa, no se invalida
      const st = (err as { statusCode?: number } | undefined)?.statusCode;
      store = markKey(loadKeys(), k.id, c.kind === 'auth' ? (st === 403 ? 'paused' : 'invalid') : 'exhausted', c.kind === 'auth' ? undefined : c.resetAt ?? now() + 3_600_000);
      saveKeys(store);
      skip.add(k.id); rotated = true;
      const next = pickKey(store.keys, now(), skip);
      if (next) o.onStatus?.({ code: 'rotated', alias: next.alias });
      continue;
    }
    // wait: misma clave, una sola vez
    if (waited) return fail(c.kind, message);
    waited = true;
    const ms = Math.min(c.retryAfterMs ?? DEFAULT_WAIT_MS, MAX_WAIT_MS);
    o.onStatus?.({ code: 'waiting', alias: k.alias, waitMs: ms });
    await sleep(ms, o.signal);
    if (o.signal?.aborted) return fail('aborted', 'aborted');
  }
}
