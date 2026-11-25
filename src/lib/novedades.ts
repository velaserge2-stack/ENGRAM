// «Qué hay de nuevo» de la barra de actualización. La app que corre es la versión VIEJA, así que las novedades de la nueva
// se leen de `novedades.json` (mismo origen, sin caché: el SW lo deja pasar). Solo texto plano, validado; si falla, la barra sale sin ellas.
export interface Novedades { id: string; mejoro: string[]; nuevo: string[] }

const SEEN = 'engrama.novedades.visto';
const MAX_ITEMS = 3, MAX_LEN = 90;

const clean = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string')
    // eslint-disable-next-line no-control-regex
    .map((x) => x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LEN))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);

/** Elige el idioma (o español) y descarta lo que no sea texto. */
export function parseNovedades(j: unknown, lang: string): Novedades | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id || o.id.length > 40) return null;
  const l = (o[lang] ?? o.es) as { mejoro?: unknown; nuevo?: unknown } | undefined;
  const mejoro = clean(l?.mejoro), nuevo = clean(l?.nuevo);
  return mejoro.length || nuevo.length ? { id: o.id, mejoro, nuevo } : null;
}

const seen = (): string | null => { try { return localStorage.getItem(SEEN); } catch { return null; } };
/** Al actualizar se recuerda el id para no repetir las mismas novedades en la siguiente barra. */
export function markSeen(id: string): void { try { localStorage.setItem(SEEN, id); } catch { /* sin almacenamiento */ } }

export async function fetchNovedades(lang: string, fetchImpl: typeof fetch = fetch): Promise<Novedades | null> {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 4000);
  try {
    const res = await fetchImpl('novedades.json', { cache: 'no-store', signal: ac.signal });
    if (!res.ok) return null;
    const n = parseNovedades(await res.json(), lang);
    return n && n.id !== seen() ? n : null;
  } catch { return null; } finally { clearTimeout(timer); }
}
