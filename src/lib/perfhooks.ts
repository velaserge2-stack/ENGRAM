/**
 * Ganchos de medición (Prompt 21). Solo se cargan con `?perf` (import() desde main.tsx): sin ese
 * parámetro este módulo no se descarga ni se ejecuta. Las pruebas (`npm run perf`) los llaman desde
 * `window.__perf.api` para medir funciones que la interfaz no expone una por una (mover 100 notas,
 * reconstruir FSRS, índice de búsqueda, respaldo). Cada gancho llama al mismo código que la interfaz.
 */
import { REVIEWS, STATE, loadCollection, loadStates, verifyDeterminism } from '../data/collection';
import { moveDeck } from '../data/move';
import { buildZip, collectVault } from '../io/zip';
import { notesIndex } from '../notes/search-client';
import { moveNotes } from '../notes/move';
import { parseLog, replay } from '../srs/engine';
import type { SafeVault } from '../vault/safe';
import { walk } from '../vault/util';
import { loadSettings, srsParams } from './settings';
import { perf } from './perf';

const now = () => performance.now();

export function install(vault: SafeVault) {
  const api = {
    /** Reconstruye FSRS desde un reviews.jsonl dado: parseo, replay, loadStates (sin caché) y verifyDeterminism. */
    async fsrs(text: string) {
      const p = srsParams(await loadSettings(vault));
      await vault.write(REVIEWS, text);
      if (await vault.exists(STATE)) await vault.remove(STATE);
      let t = now();
      const parsed = parseLog(text);
      const parseMs = now() - t;
      t = now();
      replay(parsed.entries, p);
      const replayMs = now() - t;
      t = now();
      const r = await loadStates(vault, p);
      const loadStatesMs = now() - t; // parseo + replay + escribir state.json
      t = now();
      const v = verifyDeterminism({ log: r.log, states: r.states } as never, p);
      const verifyMs = now() - t;
      return { entries: parsed.entries.length, cards: r.states.size, rebuilt: r.rebuilt, ok: v.ok, parseMs, replayMs, loadStatesMs, verifyMs };
    },
    /** Mueve todas las notas de `notes/<from>/` a `<dest>` con `moveNotes`. */
    async moveNotes(from: string, dest: string) {
      const paths = (await walk(vault, 'notes/' + from)).map((f) => f.path).filter((p) => p.endsWith('.md'));
      perf.reset();
      const t = now();
      const r = await moveNotes(vault, paths, dest);
      return { n: r.moved.length, ms: now() - t, journal: perf.c.journal ?? 0 };
    },
    /** Mueve un mazo (por ruta) a una carpeta con `moveDeck`; carga la colección antes (no se cuenta). */
    async moveDeck(path: string, folder: string) {
      const col = await loadCollection(vault, srsParams(await loadSettings(vault)));
      const d = col.decks.find((x) => x.path === path);
      if (!d) throw new Error('mazo no encontrado: ' + path);
      perf.reset();
      const t = now();
      await moveDeck(vault, col, d, folder);
      return { cards: d.cards.length, ms: now() - t, journal: perf.c.journal ?? 0 };
    },
    /** Construye el índice de búsqueda como Notas (leer todas + reset en el Worker). */
    async buildIndex() {
      const files = (await walk(vault, 'notes')).filter((f) => f.path.endsWith('.md'));
      let t = now();
      const texts = new Map<string, string>();
      for (const f of files) texts.set(f.path, new TextDecoder().decode(await vault.read(f.path)));
      const readMs = now() - t;
      t = now();
      await notesIndex.reset(texts);
      return { notes: files.length, readMs, resetMs: now() - t };
    },
    async query(q: string) {
      const t = now();
      const r = await notesIndex.query(q);
      return { hits: r.length, ms: now() - t };
    },
    /** Respaldo como `BackupSheet.prepare`: leer todo + zip. El Blob queda en `__perf.backup`. */
    async backup() {
      perf.reset();
      let t = now();
      const files = await collectVault(vault);
      const collectMs = now() - t;
      t = now();
      const zip = await buildZip(files, 'perf');
      const zipMs = now() - t;
      (window as unknown as { __backup: Blob }).__backup = new Blob([zip as BlobPart], { type: 'application/zip' });
      return { files: files.length, bytes: zip.length, collectMs, zipMs };
    },
  };
  (perf as unknown as { api: typeof api }).api = api;
}
