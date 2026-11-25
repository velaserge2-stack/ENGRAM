// Un turno del Asistente: historial + runTurn (una petición a la vez, rotación y espera 429 ya viven en session.ts).
import { add, append, generation, getStatus, messages, remove, setStatus, toModel } from './history';
import { isDemo } from '../demo/state';
import { busy, runTurn } from './session';
import { SYSTEM, SYSTEM_DELETE, SYSTEM_WRITE } from './system';
import type { Proposal } from './proposal';
import { wantsDelete, wantsWrite } from './proposal';
import type { Source, ToolCtx } from './tools';

export { SYSTEM };

let ctl: AbortController | null = null;

export const stop = (): void => ctl?.abort();

/** `env`: lo que las herramientas pueden leer (bóveda, colección, hoy). */
export async function send(text: string, env?: Omit<ToolCtx, 'sources'>): Promise<void> {
  const q = text.trim();
  if (!q) return;
  if (getStatus().busy || busy()) { add('error', '', { code: 'busy' }); return; }
  if (isDemo()) return (await import('../demo/chat')).demoSend(q, env?.col);
  const gen = generation();
  add('user', q);
  const sources: Source[] = [];
  let proposed = false;
  const reply = add('assistant', '', { sources });
  setStatus({ busy: true, waitS: undefined });
  const mine = new AbortController(); // propio del turno: un turno viejo que termine tarde no toca el de otro
  ctl = mine;
  let r: Awaited<ReturnType<typeof runTurn>>;
  try {
    const history = toModel(messages().filter((m) => m.id !== reply.id));
    // las herramientas se cargan junto al SDK, ya con el panel abierto
    // las de escritura solo si ESTE mensaje pide crear/agregar/modificar; aun así solo proponen (la UI escribe tras «Aceptar»)
    const writes = wantsWrite(q), dels = wantsDelete(q); // solo del último mensaje del USUARIO
    const propose = (ok: boolean) => (p: Proposal) => { if (ok && generation() === gen) { proposed = true; add('proposal', '', { proposal: p, pstate: 'pending' }); } };
    const tw = writes || dels ? await import('./tools-write') : null;
    const tools = env ? { ...(await import('./tools')).makeTools({ ...env, sources }), ...(writes && tw ? tw.makeWriteTools({ ...env, sources, allowed: () => writes, propose: propose(writes) }) : {}), ...(dels && tw ? tw.makeDeleteTools({ ...env, sources, allowed: () => dels, userText: q, propose: propose(dels) }) : {}) } : undefined;
    r = await runTurn({
      messages: history, system: [SYSTEM, writes && SYSTEM_WRITE, dels && SYSTEM_DELETE].filter(Boolean).join(' '), tools, signal: mine.signal, produced: () => proposed,
      onTool: (name) => { if (generation() === gen) setStatus({ tool: name }); },
      onText: (d) => { if (generation() !== gen) return; if (getStatus().tool) setStatus({ tool: undefined }); append(reply.id, d); },
      onStatus: (s) => {
        if (generation() !== gen) return;
        if (s.code === 'rotated' || s.code === 'notools') add('notice', '', { code: s.code, alias: s.alias });
        else setStatus({ waitS: Math.ceil((s.waitMs ?? 0) / 1000) });
      },
    });
  } catch {
    r = { ok: false, code: 'other', message: 'other', rotated: false };
  } finally {
    if (ctl === mine) ctl = null;
  }
  if (generation() !== gen) return; // «Nueva conversación» mientras tanto
  if (!messages().find((m) => m.id === reply.id)?.text) remove(reply.id);
  if (r.ok) setStatus({ busy: false, alias: r.alias, waitS: undefined, tool: undefined });
  else {
    setStatus({ busy: false, waitS: undefined, tool: undefined });
    add(r.code === 'aborted' ? 'notice' : 'error', '', { code: r.code, detail: r.detail });
  }
}
