// Comprobación aparte con `pdftotext` (poppler): el PDF vectorial contiene TODO el texto de un nodo de 1 000 caracteres.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/diagrams/parse';
import { exportLayout } from '../src/diagrams/export';
import { exportPdf } from '../src/diagrams/export-pdf';
import { setMeasurer } from '../src/diagrams/measure';

const has = (() => { try { execFileSync('which', ['pdftotext']); return true; } catch { return false; } })();
beforeEach(() => setMeasurer((t, f) => t.length * parseFloat(/(\d+)px/.exec(f)![1]!) * 0.55));
afterEach(() => setMeasurer(null));

describe('PDF: texto completo (pdftotext)', () => {
  it.skipIf(!has)('nodo de 1 000 caracteres sin «…»', async () => {
    const long = Array.from({ length: 101 }, (_, i) => `pal${String(i).padStart(6, '0')}`).join(' ');
    const d = parseDiagram(`[${long}] --> [Fin]`, 'flujo').doc;
    const { layout, measured } = exportLayout(d);
    for (const page of ['ajustar', 'a4'] as const) {
      const { blob, mode } = await exportPdf(d, layout, measured, { page, fit: 'una', margin: 24 });
      expect(mode).toBe('vector');
      const f = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'd.pdf');
      writeFileSync(f, new Uint8Array(await blob.arrayBuffer()));
      const txt = execFileSync('pdftotext', [f, '-']).toString();
      expect(txt).not.toContain('…');
      expect(txt.replace(/\s+/g, ' ')).toContain(long);
    }
  });
});
