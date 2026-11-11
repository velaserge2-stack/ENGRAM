import { t } from '../i18n';
/**
 * Comprobación de integridad al abrir (SPEC §3): cuenta archivos, valida
 * frontmatter y JSON, y REPORTA problemas. Nunca borra ni corrige nada.
 */
import { parseFrontmatter } from '../lib/frontmatter';
import { extname } from './paths';
import { JOURNAL_PATH, TMP_DIR } from './safe';
import type { VaultAdapter } from './types';
import { decodeText, walk } from './util';

export interface IntegrityProblem {
  path: string;
  reason: string;
}

export interface IntegrityReport {
  files: number;
  bytes: number;
  byFolder: Record<string, number>;
  problems: IntegrityProblem[];
  checkedAt: number;
}

const DECK_DIR = 'decks/';

export async function checkIntegrity(vault: VaultAdapter): Promise<IntegrityReport> {
  // El diario y los temporales son transitorios: pueden desaparecer mientras se revisa
  const files = await walk(vault, '', (p) => p === TMP_DIR || p === JOURNAL_PATH);
  const report: IntegrityReport = { files: files.length, bytes: 0, byFolder: {}, problems: [], checkedAt: Date.now() };
  for (const f of files) {
    report.bytes += f.size;
    const top = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : t('integrity.raiz');
    report.byFolder[top] = (report.byFolder[top] ?? 0) + 1;
    const ext = extname(f.path);
    if (ext !== 'md' && ext !== 'json' && ext !== 'jsonl') continue;
    let text: string;
    try {
      text = decodeText(await vault.read(f.path), true);
    } catch (e) {
      if (!(await vault.exists(f.path))) continue; // se borró o movió durante la revisión
      report.problems.push({ path: f.path, reason: e instanceof TypeError ? t('integrity.no_es_texto_utf_8_valido') : t('integrity.no_se_pudo_leer') });
      continue;
    }
    if (ext === 'md') {
      const doc = parseFrontmatter(text);
      for (const err of doc.errors) report.problems.push({ path: f.path, reason: err });
      if (f.path.startsWith(DECK_DIR) && doc.hasFrontmatter && !doc.errors.length && !doc.data.deck) {
        report.problems.push({ path: f.path, reason: t('integrity.mazo_sin_campo_deck_en_el') });
      }
    } else if (ext === 'json') {
      try {
        JSON.parse(text);
      } catch {
        report.problems.push({ path: f.path, reason: t('integrity.json_invalido') });
      }
    } else {
      text.split('\n').forEach((line, i) => {
        if (!line.trim()) return;
        try {
          JSON.parse(line);
        } catch {
          report.problems.push({ path: f.path, reason: t('integrity.linea_p_json_invalido', { p: i + 1 }) });
        }
      });
    }
  }
  return report;
}
