// Proveedores del asistente (contrato §3). El SDK solo entra con import() dinámico.
import type { LanguageModel } from 'ai';

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'kimi';
export interface Limits { rpm: number; rpd: number; tpm: number; tpd?: number }
export interface ProviderInfo { name: string; host: string; model: string; limits: Limits }

// Por defecto de Gemini: el alias `gemini-flash-latest` (apunta al Flash estable más reciente, con nivel gratuito) en vez de un
// nombre fijo sin verificar. 🔸 No se pudo comprobar con la doc oficial; el usuario puede cambiarlo en Ajustes («Ver modelos disponibles»).
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: { name: 'Gemini', host: 'generativelanguage.googleapis.com', model: 'gemini-flash-latest', limits: { rpm: 10, rpd: 250, tpm: 250_000 } },
  groq: { name: 'Groq', host: 'api.groq.com', model: 'llama-3.3-70b-versatile', limits: { rpm: 30, rpd: 1000, tpm: 12_000, tpd: 100_000 } },
  // 🔸 OpenRouter: modelo gratis con herramientas (Llama 3.3 70B); límites del nivel gratuito sin verificar (sin créditos ~20/min y 50/día).
  openrouter: { name: 'OpenRouter', host: 'openrouter.ai', model: 'meta-llama/llama-3.3-70b-instruct:free', limits: { rpm: 20, rpd: 50, tpm: 100_000 } },
  // 🔸 Kimi (Moonshot, api.moonshot.ai): K2 con llamadas a herramientas; los límites reales dependen del saldo acumulado.
  kimi: { name: 'Kimi', host: 'api.moonshot.ai', model: 'kimi-k2-0905-preview', limits: { rpm: 20, rpd: 1000, tpm: 128_000 } },
};
export const BASE: Partial<Record<ProviderId, string>> = { openrouter: 'https://openrouter.ai/api/v1', kimi: 'https://api.moonshot.ai/v1' };

// ───────── Presupuestos de contexto por proveedor y modo (Ajustes → Asistente → «Contexto») ─────────
export type CtxMode = 'normal' | 'amplio';
export interface Budget {
  /** tokens de salida pedidos (`maxOutputTokens`) */ maxOut: number;
  /** pasos modelo↔herramientas por turno */ steps: number;
  /** presupuesto del historial enviado, en tokens (≈ caracteres / 4) */ histTokens: number;
  /** fragmentos por herramienta: cuántos y de cuántos caracteres */ frag: { n: number; chars: number };
  /** máximo de caracteres que devuelve `leer_nota` por llamada */ noteChars: number;
  /** PDF: archivos revisados, páginas leídas por archivo y caracteres por fragmento */ pdf: { files: number; pages: number; chars: number };
  /** máximo de caracteres de una nota/diagrama que se puede proponer */ writeChars: number;
}
/** Tokens estimados de la instrucción de sistema + esquemas de herramientas (para comprobar el tope de Groq). */
export const SYS_TOKENS = 1500;
export const estTokens = (chars: number): number => Math.ceil(chars / 4);
/** Tope de caracteres que las herramientas pueden devolver en TODO un turno. */
export const toolCap = (b: Budget): number => b.histTokens * 4;
// 🔸 Cifras razonadas, sin verificar con las APIs reales: dependen del modelo elegido y del plan del usuario.
//   gemini: Flash admite ~1 M de contexto y hasta 65 k de salida; la cuota gratuita (TPM 250 k) se agota antes en «amplio».
//   groq: TPM 12 000 por petición (entrada + salida pedida): nunca > ~10 000 tokens estimados en total, en ningún modo.
//   openrouter: Llama 3.3 70B (128 k de contexto) u otro modelo gratuito: valores medios. kimi: K2 con 128–256 k.
export const BUDGET: Record<ProviderId, Record<CtxMode, Budget>> = {
  gemini: {
    normal: { maxOut: 8192, steps: 6, histTokens: 24_000, frag: { n: 8, chars: 1000 }, noteChars: 12_000, pdf: { files: 3, pages: 60, chars: 1000 }, writeChars: 20_000 },
    amplio: { maxOut: 32_768, steps: 12, histTokens: 200_000, frag: { n: 16, chars: 2000 }, noteChars: 60_000, pdf: { files: 5, pages: 200, chars: 2000 }, writeChars: 100_000 },
  },
  groq: {
    normal: { maxOut: 3072, steps: 6, histTokens: 2000, frag: { n: 4, chars: 600 }, noteChars: 3000, pdf: { files: 2, pages: 40, chars: 600 }, writeChars: 20_000 },
    amplio: { maxOut: 4096, steps: 6, histTokens: 2000, frag: { n: 5, chars: 700 }, noteChars: 4000, pdf: { files: 2, pages: 60, chars: 700 }, writeChars: 20_000 },
  },
  openrouter: {
    normal: { maxOut: 4096, steps: 6, histTokens: 12_000, frag: { n: 6, chars: 800 }, noteChars: 8000, pdf: { files: 3, pages: 60, chars: 800 }, writeChars: 20_000 },
    amplio: { maxOut: 8192, steps: 8, histTokens: 32_000, frag: { n: 10, chars: 1200 }, noteChars: 24_000, pdf: { files: 3, pages: 100, chars: 1200 }, writeChars: 40_000 },
  },
  kimi: {
    normal: { maxOut: 8192, steps: 6, histTokens: 16_000, frag: { n: 8, chars: 1000 }, noteChars: 12_000, pdf: { files: 3, pages: 60, chars: 1000 }, writeChars: 20_000 },
    amplio: { maxOut: 16_384, steps: 10, histTokens: 48_000, frag: { n: 12, chars: 1500 }, noteChars: 40_000, pdf: { files: 4, pages: 120, chars: 1500 }, writeChars: 60_000 },
  },
};
let mode: CtxMode = 'normal', active: ProviderId = 'gemini';
/** El proveedor de la clave en uso (lo fija la sesión antes de cada intento; las herramientas lo leen al ejecutarse). */
export const setActive = (p: ProviderId): void => { active = p; };
export const budget = (p: ProviderId = active, m: CtxMode = mode): Budget => BUDGET[p][m];
/** Tope de la nota escrita por el asistente tras «Editar» (el mayor de todos los modos). */
export const MAX_WRITE = 100_000;

export function loadCore(): Promise<typeof import('ai')> {
  return import('ai');
}

let chosen: Partial<Record<ProviderId, string>> = {};
/** Modelos elegidos en Ajustes (`settings.chat.models`) y modo de contexto (`settings.chat.context`); la interfaz lo fija antes de cada turno o prueba. */
export const setModels = (m: Partial<Record<ProviderId, string>> | undefined, context?: CtxMode): void => { chosen = { ...m }; if (context) mode = context === 'amplio' ? 'amplio' : 'normal'; };
export const modelOf = (p: ProviderId): string => chosen[p] || PROVIDERS[p].model;

/** Siempre el objeto modelo (una cadena activaría @ai-sdk/gateway). `fetchImpl` solo para pruebas. */
export async function loadModel(p: ProviderId, apiKey: string, fetchImpl?: typeof fetch): Promise<LanguageModel> {
  const model = modelOf(p);
  if (p === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    return createGoogleGenerativeAI({ apiKey, fetch: fetchImpl })(model);
  }
  if (p === 'groq') {
    const { createGroq } = await import('@ai-sdk/groq');
    return createGroq({ apiKey, fetch: fetchImpl })(model);
  }
  // OpenRouter y Kimi hablan el dialecto OpenAI; sin cabeceras HTTP-Referer/X-Title (opcionales; no se envía nada que identifique la app).
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  return createOpenAICompatible({ name: p, baseURL: BASE[p]!, apiKey, fetch: fetchImpl })(model);
}
