// Un turno del Asistente: historial + runTurn (una petición a la vez, rotación y espera 429 ya viven en session.ts).
import { add, append, generation, getStatus, messages, remove, setStatus, toModel } from './history';
import { isDemo } from '../demo/state';
import { busy, runTurn } from './session';
import { fetchAcct, hasAcct } from './account';
import { loadKeys } from './keys';
import { loadUsage, saveUsage, setAcct } from './usage';
import { SYSTEM, ctxUser } from './system';
import { DEFAULT_PREFS, composeSystem, filterTools, plan, ROLES, stickyWrite, wantsConvert, writeSubset, type Prefs } from './roles';
import { loadCtx, type ChatCtx } from './context';
import type { Proposal } from './proposal';
import { wantsDelete, wantsWrite } from './proposal';
import type { Source, ToolCtx } from './tools';
import type { ToolSet } from 'ai';

// Gancho del carril «Exámenes»: si existe src/chat/tools-exam.ts (exporta `makeExamTools(ctx)`), se carga bajo demanda; si no, no pasa nada.
const examMod = import.meta.glob<{ makeExamTools?: (c: unknown) => ToolSet }>('./tools-exam.ts');
const actionMod = import.meta.glob<{ makeActionTools?: (c: unknown) => ToolSet }>('./tools-actions.ts'); // carril de acciones (pomodoro, sonido, navegar, tareas)
const analyticsMod = import.meta.glob<{ makeAnalyticsTools?: (c: unknown) => ToolSet }>('./tools-analytics.ts'); // carril de analítica (solo lectura)
async function appTools(wctx: Parameters<typeof import('./tools-app').makeAppTools>[0], settings: import('../lib/settings').Settings, vault: Parameters<typeof import('./tools-app').appLists>[0]): Promise<ToolSet> {
  const m = await import('./tools-app');
  let lists: Awaited<ReturnType<typeof m.appLists>> | null = null;
  return m.makeAppTools(wctx, { settings, lists: async () => (lists ??= await m.appLists(vault)) });
}

/** `prefs`: rol, socrático y nivel · `ctx`: contexto con el que se abrió el chat · `write`: un botón interno fuerza las herramientas de escritura. */
export interface SendOpts { prefs?: Prefs; ctx?: ChatCtx | null; write?: boolean; /** lo que hace falta para proponer cambios de ajustes: valores actuales, `go` y el `app.update` lo aplica la UI */ app?: { settings: import('../lib/settings').Settings } }

export { SYSTEM };

let ctl: AbortController | null = null;

export const stop = (): void => ctl?.abort();

/** `env`: lo que las herramientas pueden leer (bóveda, colección, hoy). */
export async function send(text: string, env?: Omit<ToolCtx, 'sources'>, opts: SendOpts = {}): Promise<void> {
  const q = text.trim();
  if (!q) return;
  if (getStatus().busy || busy()) { add('error', '', { code: 'busy' }); return; }
  if (isDemo()) return (await import('../demo/chat')).demoSend(q, env?.col);
  const gen = generation();
  const prev = messages(), prefs = opts.prefs ?? DEFAULT_PREFS;
  const sticky = stickyWrite(q, { assistant: [...prev].reverse().find((m) => m.role === 'assistant' && m.text)?.text, proposed: false });
  const prevUser = [...prev].reverse().find((m) => m.role === 'user')?.text ?? '';
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
    const pl = plan(prefs.role, { wantsWrite: wantsWrite(q) || sticky, wantsDelete: wantsDelete(q), wantsConvert: wantsConvert(q) || (sticky && wantsConvert(prevUser)), force: opts.write }); // borrar nunca es «pegajoso»
    const propose = (ok: boolean) => (p: Proposal) => { if (ok && generation() === gen) { proposed = true; add('proposal', '', { proposal: p, pstate: 'pending' }); } };
    const tw = pl.writes || pl.dels ? await import('./tools-write') : null;
    let tools: ToolSet | undefined;
    if (env) {
      const wctx = { ...env, sources, userText: q, allowed: () => pl.writes, propose: propose(pl.writes) };
      const writeTools: ToolSet = pl.writes && tw ? { ...tw.makeWriteTools(wctx), ...(await import('./tools-edit')).makeEditTools(wctx), ...(opts.app ? await appTools(wctx, opts.app.settings, env.vault) : {}), ...(pl.convert ? (await import('./tools-convert')).makeConvertTools(wctx) : {}) } : {};
      const all = { ...(await import('./tools')).makeTools({ ...env, sources }), ...writeSubset(writeTools, `${sticky ? prevUser + ' ' : ''}${q}`, true), ...(pl.dels && tw ? tw.makeDeleteTools({ ...env, sources, allowed: () => pl.dels, userText: q, propose: propose(pl.dels) }) : {}) };
      tools = filterTools(all, prefs.role) as ToolSet;
      const ex = pl.writes && ROLES[prefs.role].exam ? examMod['./tools-exam.ts'] : undefined;
      const more = [pl.writes && ROLES[prefs.role].tools === null ? actionMod['./tools-actions.ts'] : undefined, prefs.role !== 'investigador' ? analyticsMod['./tools-analytics.ts'] : undefined];
      for (const [i, l] of more.entries()) if (l) { try { const mod = await l(); Object.assign(tools, ((i ? (mod as { makeAnalyticsTools?: (c: unknown) => ToolSet }).makeAnalyticsTools : (mod as { makeActionTools?: (c: unknown) => ToolSet }).makeActionTools)?.(wctx)) ?? {}); } catch { /* carril aún no entregado o falló */ } }
      if (ex) { try { Object.assign(tools, (await ex()).makeExamTools?.(wctx) ?? {}); } catch { /* el carril B aún no la entrega o falló: sin ella */ } }
    }
    const cx = opts.ctx && env ? await loadCtx(env, opts.ctx, sources) : null;
    const last = history[history.length - 1];
    if (cx && last && last.role === 'user' && typeof last.content === 'string') last.content = `${ctxUser(cx.label, cx.body)}\n\n${last.content}`;
    r = await runTurn({
      messages: history, system: composeSystem(prefs, { ...pl, ctx: cx, app: pl.writes && !!opts.app }), tools, signal: mine.signal, produced: () => proposed,
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
  if (r.ok) {
    setStatus({ busy: false, alias: r.alias, waitS: undefined, tool: undefined });
    // OpenRouter y Kimi: refrescar lo que queda tras la respuesta (Groq ya lo trae en las cabeceras; Gemini no expone nada)
    const k = loadKeys().keys.find((x) => x.id === r.keyId);
    if (k && hasAcct(k.provider) && !isDemo()) void fetchAcct(k.provider, k.key, new AbortController().signal).then((a) => { if (a) { saveUsage(setAcct(loadUsage(), k.id, a)); setStatus({}); } });
  }
  else {
    setStatus({ busy: false, waitS: undefined, tool: undefined });
    add(r.code === 'aborted' ? 'notice' : 'error', '', { code: r.code, detail: r.detail });
  }
}
