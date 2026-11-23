// Un turno del Asistente: historial + runTurn (una petición a la vez, rotación y espera 429 ya viven en session.ts).
import { add, append, generation, getStatus, messages, remove, setStatus, toModel } from './history';
import { busy, runTurn } from './session';

/** Instrucción de sistema (no es texto de interfaz). Sin herramientas: no puede leer notas ni archivos. */
export const SYSTEM = 'You are the study assistant inside Engrama, an offline spaced-repetition and notes app. '
  + 'Answer short and simple by default, and expand only when asked. Always reply in the language the user writes in. '
  + 'You have no tools: you cannot read the user\'s notes, cards or files, so never claim to have seen them; if they matter, ask the user to paste the text. '
  + 'Use Markdown sparingly.';

let ctl: AbortController | null = null;

export const stop = (): void => ctl?.abort();

export async function send(text: string): Promise<void> {
  const q = text.trim();
  if (!q) return;
  if (getStatus().busy || busy()) { add('error', '', { code: 'busy' }); return; }
  const gen = generation();
  add('user', q);
  const reply = add('assistant', '');
  setStatus({ busy: true, waitS: undefined });
  ctl = new AbortController();
  const history = toModel(messages().filter((m) => m.id !== reply.id));
  const r = await runTurn({
    messages: history, system: SYSTEM, signal: ctl.signal,
    onText: (d) => { if (generation() === gen) append(reply.id, d); },
    onStatus: (s) => {
      if (generation() !== gen) return;
      if (s.code === 'rotated') add('notice', '', { code: 'rotated', alias: s.alias });
      else setStatus({ waitS: Math.ceil((s.waitMs ?? 0) / 1000) });
    },
  });
  ctl = null;
  if (generation() !== gen) return; // «Nueva conversación» mientras tanto
  if (!messages().find((m) => m.id === reply.id)?.text) remove(reply.id);
  if (r.ok) setStatus({ busy: false, alias: r.alias, waitS: undefined });
  else {
    setStatus({ busy: false, waitS: undefined });
    add(r.code === 'aborted' ? 'notice' : 'error', '', { code: r.code });
  }
}
