// «Ver modelos disponibles»: un GET al listado del proveedor con la clave en cabecera (nunca en la URL).
import { classify, type Classified } from './errors';
import type { ProviderId } from './providers';

export const LIST_MS = 15_000, MAX_PAGES = 5;
const URLS: Record<ProviderId, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
  groq: 'https://api.groq.com/openai/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  kimi: 'https://api.moonshot.ai/v1/models',
};
// no son de texto/chat
const NOT_CHAT = /whisper|guard|tts|playai|orpheus|embed|aqa|imagen|veo|image|live|native-audio|robotics|computer-use|transcri/i;
const rank = (p: ProviderId, id: string) => (p === 'gemini' ? (/flash/.test(id) ? 0 : 1) : p === 'openrouter' ? (/:free$/.test(id) ? 0 : 1) : p === 'kimi' ? (/kimi-k2/.test(id) ? 0 : 1) : /llama|gpt-oss/.test(id) ? 0 : 1);
const sortIds = (p: ProviderId, ids: string[]) => [...new Set(ids)].sort((a, b) => rank(p, a) - rank(p, b) || a.localeCompare(b));

/** Gemini: `{models:[{name:'models/x', supportedGenerationMethods:[…]}], nextPageToken?}`. */
export function parseGemini(j: unknown): { ids: string[]; next?: string } {
  const o = (j ?? {}) as { models?: unknown; nextPageToken?: unknown };
  const ids = (Array.isArray(o.models) ? o.models : []).flatMap((m: { name?: unknown; supportedGenerationMethods?: unknown }) => {
    const id = typeof m?.name === 'string' ? m.name.replace(/^models\//, '') : '';
    return id && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent') && !NOT_CHAT.test(id) ? [id] : [];
  });
  return { ids, next: typeof o.nextPageToken === 'string' && o.nextPageToken ? o.nextPageToken : undefined };
}
/** Groq (OpenAI): `{data:[{id, active?}]}`. */
export function parseGroq(j: unknown): { ids: string[] } {
  const d = (j as { data?: unknown } | null)?.data;
  return { ids: (Array.isArray(d) ? d : []).flatMap((m: { id?: unknown; active?: unknown }) => (typeof m?.id === 'string' && m.id && m.active !== false && !NOT_CHAT.test(m.id) ? [m.id] : [])) };
}
/** OpenRouter: `{data:[{id, pricing:{prompt,completion}}]}`; los gratuitos (`:free` o precio 0) llevan `:free` en el id o van primero por precio. */
export function parseOpenRouter(j: unknown): { ids: string[] } {
  const d = (j as { data?: unknown } | null)?.data;
  const free = (m: { id: string; pricing?: { prompt?: unknown; completion?: unknown } }) => /:free$/.test(m.id) || (m.pricing?.prompt !== undefined && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
  const ms = (Array.isArray(d) ? d : []).filter((m: { id?: unknown }) => typeof m?.id === 'string' && m.id && !NOT_CHAT.test(m.id)) as { id: string; pricing?: { prompt?: unknown; completion?: unknown } }[];
  return { ids: [...ms.filter(free), ...ms.filter((m) => !free(m))].map((m) => m.id) };
}
/** Primero razonable (solo sugerencia; no se fija). */
export const suggest = (p: ProviderId, ids: string[]): string | undefined => ids.find((i) => rank(p, i) === 0);

export type ListResult = { ok: true; ids: string[]; suggested?: string } | { ok: false; c: Classified };

export async function listModels(p: ProviderId, key: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ListResult> {
  const ids: string[] = [];
  try {
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = URLS[p] + (token ? '&pageToken=' + encodeURIComponent(token) : '');
      const res = await fetchImpl(url, { method: 'GET', signal, headers: p === 'gemini' ? { 'x-goog-api-key': key } : { Authorization: 'Bearer ' + key } });
      const body = await res.text();
      if (!res.ok) return { ok: false, c: classify(p, { statusCode: res.status, responseBody: body.slice(0, 2000), responseHeaders: Object.fromEntries(res.headers.entries()) }, Date.now(), [key]) };
      let j: unknown;
      try { j = JSON.parse(body); } catch { return { ok: false, c: { kind: 'other' } }; }
      if (p === 'groq' || p === 'kimi') { ids.push(...parseGroq(j).ids); break; }
      if (p === 'openrouter') { ids.push(...parseOpenRouter(j).ids); break; }
      const r = parseGemini(j);
      ids.push(...r.ids);
      if (!r.next) break;
      token = r.next;
    }
  } catch (e) {
    return { ok: false, c: signal.aborted ? { kind: 'aborted' } : classify(p, e, Date.now(), [key]) };
  }
  const sorted = p === 'openrouter' ? [...new Set(ids)] : sortIds(p, ids); // OpenRouter ya viene con los gratuitos primero
  return { ok: true, ids: sorted, suggested: suggest(p, sorted) };
}
