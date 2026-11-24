// Proveedores del asistente (contrato §3). El SDK solo entra con import() dinámico.
import type { LanguageModel } from 'ai';

export type ProviderId = 'gemini' | 'groq';
export interface Limits { rpm: number; rpd: number; tpm: number; tpd?: number }
export interface ProviderInfo { name: string; host: string; model: string; limits: Limits }

// Por defecto de Gemini: el alias `gemini-flash-latest` (apunta al Flash estable más reciente, con nivel gratuito) en vez de un
// nombre fijo sin verificar. 🔸 No se pudo comprobar con la doc oficial; el usuario puede cambiarlo en Ajustes («Ver modelos disponibles»).
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: { name: 'Gemini', host: 'generativelanguage.googleapis.com', model: 'gemini-flash-latest', limits: { rpm: 10, rpd: 250, tpm: 250_000 } },
  groq: { name: 'Groq', host: 'api.groq.com', model: 'llama-3.3-70b-versatile', limits: { rpm: 30, rpd: 1000, tpm: 12_000, tpd: 100_000 } },
};

export function loadCore(): Promise<typeof import('ai')> {
  return import('ai');
}

let chosen: Partial<Record<ProviderId, string>> = {};
/** Modelos elegidos en Ajustes (`settings.chat.models`); la interfaz lo fija antes de cada turno o prueba. */
export const setModels = (m: Partial<Record<ProviderId, string>> | undefined): void => { chosen = { ...m }; };
export const modelOf = (p: ProviderId): string => chosen[p] || PROVIDERS[p].model;

/** Siempre el objeto modelo (una cadena activaría @ai-sdk/gateway). `fetchImpl` solo para pruebas. */
export async function loadModel(p: ProviderId, apiKey: string, fetchImpl?: typeof fetch): Promise<LanguageModel> {
  const model = modelOf(p);
  if (p === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey, fetch: fetchImpl })(model);
  }
  const { createGroq } = await import('@ai-sdk/groq');
  return createGroq({ apiKey, fetch: fetchImpl })(model);
}
