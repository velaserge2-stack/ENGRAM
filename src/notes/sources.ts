/**
 * Prompt 17 · mover bloques sin romper la cobertura: las tarjetas creadas desde un párrafo guardan
 * `<!-- src: notes/X.md#pN -->` (N = número de párrafo). Si la barra reordena párrafos, se
 * reescribe N en los mazos que lo citan (por SafeVault). Solo cambia el número; nada más del mazo.
 */
import type { VaultAdapter } from '../vault/types';
import { paraMap } from './format';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function remapSources(vault: VaultAdapter, decks: string[], path: string, oldBody: string, newBody: string): Promise<number> {
  if (!decks.length || oldBody === newBody) return 0;
  const map = paraMap(oldBody, newBody);
  if ([...map].every(([a, b]) => a === b)) return 0;
  const re = new RegExp(`(<!--\\s*src:\\s*${esc(path)}#p)(\\d+)(\\s*-->)`, 'g');
  let n = 0;
  for (const d of decks) {
    let text: string;
    try { text = new TextDecoder().decode(await vault.read(d)); } catch { continue; }
    const next = text.replace(re, (all, a: string, i: string, b: string) => { const j = map.get(Number(i)); return j === undefined || j === Number(i) ? all : (n++, `${a}${j}${b}`); });
    if (next !== text) await vault.write(d, next);
  }
  return n;
}
