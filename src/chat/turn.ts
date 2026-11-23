// Un turno del Asistente: historial + runTurn (una petición a la vez, rotación y espera 429 ya viven en session.ts).
import { add, append, generation, getStatus, messages, remove, setStatus, toModel } from './history';
import { busy, runTurn } from './session';
import { SYSTEM } from './system';
import type { Source, ToolCtx } from './tools';

export { SYSTEM };

let ctl: AbortController | null = null;

export const stop = (): void => ctl?.abort();

/** `env`: lo que las herramientas pueden leer (bóveda, colección, hoy). */
export async function send(text: string, env?: Omit<ToolCtx, 'sources'>): Promise<void> {
  const q = text.trim();
  if (!q) return;
  if (getStatus().busy || busy()) { add('error', '', { code: 'busy' }); return; }
  const gen = generation();
  add('user', q);
  const sources: Source[] = [];
  const reply = add('assistant', '', { sources });
  setStatus({ busy: true, waitS: undefined });
  ctl = new AbortController();
  const history = toModel(messages().filter((m) => m.id !== reply.id));
  // las herramientas se cargan junto al SDK, ya con el panel abierto
  const tools = env ? (await import('./tools')).makeTools({ ...env, sources }) : undefined;
  const r = await runTurn({
    messages: history, system: SYSTEM, tools, signal: ctl.signal,
    onTool: (name) => { if (generation() === gen) setStatus({ tool: name }); },
    onText: (d) => { if (generation() !== gen) return; if (getStatus().tool) setStatus({ tool: undefined }); append(reply.id, d); },
    onStatus: (s) => {
      if (generation() !== gen) return;
      if (s.code === 'rotated') add('notice', '', { code: 'rotated', alias: s.alias });
      else setStatus({ waitS: Math.ceil((s.waitMs ?? 0) / 1000) });
    },
  });
  ctl = null;
  if (generation() !== gen) return; // «Nueva conversación» mientras tanto
  if (!messages().find((m) => m.id === reply.id)?.text) remove(reply.id);
  if (r.ok) setStatus({ busy: false, alias: r.alias, waitS: undefined, tool: undefined });
  else {
    setStatus({ busy: false, waitS: undefined, tool: undefined });
    add(r.code === 'aborted' ? 'notice' : 'error', '', { code: r.code });
  }
}
