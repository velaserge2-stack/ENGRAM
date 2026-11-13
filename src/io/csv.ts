/** CSV/TSV mínimo con comillas (RFC 4180). Detecta el separador por la primera línea. */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split('\n', 1)[0] ?? '';
  const head = first.replace(/"[^"]*"/g, ''); // las comillas no cuentan al elegir el separador
  const sep = (head.match(/\t/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? '\t' : (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) (row.push(cell), (cell = ''));
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export interface CsvMapping {
  front: number;
  back: number;
  type: number;
  tags: number;
  image: number;
  header: boolean;
}

export function guessMapping(rows: string[][]): CsvMapping {
  const h = (rows[0] ?? []).map((x) => x.trim().toLowerCase());
  const find = (...names: string[]) => h.findIndex((x) => names.includes(x));
  const header = find('pregunta', 'question', 'frente', 'front', 'respuesta', 'answer') >= 0;
  return {
    header,
    front: header ? Math.max(0, find('pregunta', 'question', 'frente', 'front')) : 0,
    back: header ? find('respuesta', 'answer', 'reverso', 'back') : 1,
    type: header ? find('tipo', 'type') : -1,
    tags: header ? find('etiquetas', 'tags') : -1,
    image: header ? find('imagen', 'image') : -1,
  };
}

const flat = (s: string) => s.replace(/\r?\n\s*\r?\n/g, '\n').trim();

/** Filas → bloques de tarjeta (sin ID; se añaden al guardar). */
export function rowsToBlocks(rows: string[][], m: CsvMapping): { block: string; error: string | null }[] {
  return rows.slice(m.header ? 1 : 0).map((r) => {
    const front = flat(r[m.front] ?? '');
    const back = flat(m.back >= 0 ? (r[m.back] ?? '') : '');
    const type = (m.type >= 0 ? r[m.type] ?? '' : '').trim().toLowerCase();
    const img = m.image >= 0 && r[m.image]?.trim() ? `\n![[${r[m.image]!.trim()}]]` : '';
    const tags = m.tags >= 0 && r[m.tags]?.trim() ? ` <!-- tags: ${r[m.tags]!.trim()} -->` : '';
    if (!front) return { block: '', error: 'Fila sin pregunta' };
    if (type.startsWith('cloze') || /\{\{c\d+::/.test(front)) return { block: `Cloze: ${front}${img}${tags}`, error: /\{\{c\d+::/.test(front) ? null : 'Cloze sin huecos' };
    if (!back) return { block: `Q:: ${front}${img}\nA:: `, error: 'Fila sin respuesta' };
    const pre = type.startsWith('inv') || type === 'reverse' ? 'QR' : type.startsWith('escrib') || type === 'type' ? 'T' : 'Q';
    return { block: `${pre}:: ${front}${img}\nA:: ${back}${tags}`, error: null };
  });
}
