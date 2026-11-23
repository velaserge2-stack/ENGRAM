// Proveedores del asistente (contrato §3). El SDK solo entra con import() dinámico.
import type { LanguageModel } from 'ai';

export type ProviderId = 'gemini' | 'groq';
export interface Limits { rpm: number; rpd: number; tpm: number; tpd?: number }
export interface ProviderInfo { name: string; host: string; model: string; limits: Limits }

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: { name: 'Gemini', host: 'generativelanguage.googleapis.com', model: 'gemini-3.5-flash', limits: { rpm: 10, rpd: 250, tpm: 250_000 } },
  groq: { name: 'Groq', host: 'api.groq.com', model: 'llama-3.3-70b-versatile', limits: { rpm: 30, rpd: 1000, tpm: 12_000, tpd: 100_000 } },
};

export function loadCore(): Promise<typeof import('ai')> {
  return import('ai');
}

/** Siempre el objeto modelo (una cadena activaría @ai-sdk/gateway). `fetchImpl` solo para pruebas. */
export async function loadModel(p: ProviderId, apiKey: string, fetchImpl?: typeof fetch): Promise<LanguageModel> {
  const model = PROVIDERS[p].model;
  if (p === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey, fetch: fetchImpl })(model);
  }
  const { createGroq } = await import('@ai-sdk/groq');
  return createGroq({ apiKey, fetch: fetchImpl })(model);
}
