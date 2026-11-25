// Sesión en streaming (contrato §6). Una petición a la vez; rotación solo ante quota/auth y antes de recibir texto.
import type { ModelMessage, ToolSet } from 'ai';
import { classify, decide, redact, type Detail, type Kind } from './errors';
import { loadKeys, markKey, pickKey, saveKeys } from './keys';
import { trimMessages } from './history';
import { budget, loadCore, loadModel, modelOf, setActive } from './providers';
import { fromHeaders, loadUsage, record, saveUsage, setHdr } from './usage';

export const MAX_WAIT_MS = 60_000;
export const TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_MS = 5_000;

export interface TurnOpts {
  messages: ModelMessage[];
  system?: string;
  tools?: ToolSet;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  /** Códigos para la interfaz: 'rotated' (cambió de clave) | 'waiting' (429 por minuto) | 'notools' (el modelo no admite herramientas: se repite sin ellas). */
  /** Una herramienta fue llamada; la interfaz lo muestra hasta que llega texto. */
  /** ¿el turno ya produjo algo visible aparte del texto (p. ej. una propuesta)? */
  produced?: () => boolean;
  onTool?: (name: string) => void;
  onStatus?: (s: { code: 'rotated' | 'waiting' | 'notools'; alias: string; waitMs?: number }) => void;
  /** Solo pruebas. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
export type TurnResult =
  | { ok: true; text: string; alias: string; keyId?: string; rotated: boolean; tokens: number }
  | { ok: false; code: 'busy' | 'nokey' | Kind; message: string; rotated: boolean; detail?: Detail };

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

/** «tool calling is not supported with this model» (Groq), «does not support tools», «No endpoints found that support tool use» (OpenRouter)… */
export const NO_TOOLS = /tool[s _-]*(calling|use|call)?[`'"]?\s*(is |are )?not supported|(does not|doesn't) support (tools|tool|function)|no endpoints found that support tool/i;

async function run(o: TurnOpts): Promise<TurnResult> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? sleepAbortable;
  let store = loadKeys();
  const skip = new Set<string>();
  let rotated = false, waited = false, halved = false, notools = false; // halved: ya se reintentó con la mitad de salida (400 por max_tokens)
  let last: { code: Kind; message: string; detail?: Detail } | null = null;
  const fail = (code: 'nokey' | Kind, message: string, detail?: Detail): TurnResult => ({ ok: false, code, message: redact(message, store.keys.map((k) => k.key)), rotated, detail });

  for (;;) {
    const k = pickKey(store.keys, now(), skip);
    if (!k) return last ? fail(last.code, last.message, last.detail) : fail('nokey', 'nokey');
    let text = '', err: unknown, stepped = false, timedOut = false, toolErr = '';
    // un AbortController por intento: Detener o 120 s sin señales del servidor lo cortan
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (o.signal?.aborted) ac.abort(); else o.signal?.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeoutMs ?? TIMEOUT_MS); };
    try {
      arm();
      setActive(k.provider);
      const b = budget(k.provider), maxOut = halved ? Math.max(256, b.maxOut >> 1) : b.maxOut;
      const [core, model] = await Promise.all([loadCore(), loadModel(k.provider, k.key, o.fetch)]);
      const r = core.streamText({
        model, system: notools ? o.system + ' En esta conversación no tienes herramientas: no digas que buscaste, leíste o cambiaste notas, tarjetas o mazos.' : o.system, messages: trimMessages(o.messages, b.histTokens), tools: notools ? undefined : o.tools,
        stopWhen: core.stepCountIs(b.steps),
        // último paso sin herramientas: obliga a cerrar con texto
        prepareStep: ({ stepNumber }) => (stepNumber >= b.steps - 1 ? { toolChoice: 'none' as const } : undefined),
        ...(k.provider === 'gemini' ? { providerOptions: { google: { thinkingConfig: { thinkingBudget: Math.min(4096, Math.max(1024, maxOut >> 3)), includeThoughts: false } } } } : {}), maxRetries: 0, maxOutputTokens: maxOut, abortSignal: ac.signal,
        onError: ({ error }) => { err = err ?? error; },
      });
      for await (const part of r.fullStream) {
        arm();
        if (part.type === 'text-delta') { text += part.text; o.onText?.(part.text); }
        else if (part.type === 'tool-call') { stepped = true; o.onTool?.(part.toolName); }
        else if (part.type === 'tool-result') stepped = true;
        else if (part.type === 'tool-error') { toolErr = toolErr || redact(String((part.error as { message?: string } | undefined)?.message ?? part.error), store.keys.map((x) => x.key)).slice(0, 160); }
        else if (part.type === 'error') err = err ?? part.error;
      }
      if (!err && !timedOut && !o.signal?.aborted) {
        let tokens = 0, headers: Record<string, string> | undefined;
        try { tokens = (await r.totalUsage).totalTokens ?? 0; } catch { /* sin cifra */ }
        try { headers = (await (r as unknown as { response: PromiseLike<{ headers?: Record<string, string> }> }).response).headers; } catch { /* sin cabeceras */ }
        const t = now();
        saveUsage(setHdr(record(loadUsage(), k.id, tokens, t, k.provider), k.id, fromHeaders(k.provider, headers, t)));
        if (!text.trim() && !o.produced?.()) {
          let why = '', steps = 0;
          try { why = String(await r.finishReason); steps = (await r.steps).length; } catch { /* sin motivo */ }
          const msg = redact(`motivo: ${why || '?'} · pasos ${steps}${toolErr ? ' · ' + toolErr : ''}`, store.keys.map((x) => x.key));
          return fail('empty', 'empty', { msg });
        }
        return { ok: true, text, alias: k.alias, keyId: k.id, rotated, tokens };
      }
    } catch (e) { err = e; } finally { clearTimeout(timer); o.signal?.removeEventListener('abort', onAbort); }

    const c = o.signal?.aborted ? { kind: 'aborted' as Kind } : timedOut ? { kind: 'timeout' as Kind, detail: undefined as Detail | undefined } : classify(k.provider, err, now(), store.keys.map((x) => x.key));
    const message = String((err as { message?: string } | undefined)?.message ?? c.kind);
    const detail = c.kind === 'model' ? { ...c.detail, model: modelOf(k.provider) } : c.detail;
    last = { code: c.kind, message, detail };
    // 400 por max_tokens: una sola vez con la mitad, misma clave, sin rotar
    if (c.kind === 'limit' && !halved && !text && !stepped) { halved = true; continue; }
    // el modelo elegido no admite herramientas (p. ej. allam-2-7b en Groq): una vez sin ellas, misma clave
    if (o.tools && !notools && !text && !stepped && NO_TOOLS.test(message + ' ' + (detail?.msg ?? ''))) { notools = true; o.onStatus?.({ code: 'notools', alias: k.alias }); continue; }
    const d = decide(c.kind);
    if (text || stepped || d === 'fail') return fail(c.kind, message, detail);
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
    if (waited) return fail(c.kind, message, detail);
    waited = true;
    const ms = Math.min(c.retryAfterMs ?? DEFAULT_WAIT_MS, MAX_WAIT_MS);
    o.onStatus?.({ code: 'waiting', alias: k.alias, waitMs: ms });
    await sleep(ms, o.signal);
    if (o.signal?.aborted) return fail('aborted', 'aborted');
  }
}
