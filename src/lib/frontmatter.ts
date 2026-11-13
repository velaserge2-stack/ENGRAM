import { t } from '../i18n';
/**
 * Frontmatter YAML: subconjunto pequeño y estricto, suficiente para los archivos
 * de Engrama y la mayoría de notas de Obsidian:
 *   clave: valor | clave: "texto" | clave: [a, b] | clave: (y debajo "- elemento")
 * Números y booleanos se convierten. Lo demás se reporta como error, nunca se borra.
 */
type FMValue = string | number | boolean | null | FMValue[];
export type Frontmatter = Record<string, FMValue>;

export interface ParsedDoc {
  data: Frontmatter;
  body: string;
  hasFrontmatter: boolean;
  errors: string[];
}

function scalar(raw: string): FMValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    const inner = s.slice(1, -1);
    // una sola pasada (si no, «\\\\» se duplica en cada ida y vuelta); las demás secuencias quedan tal cual
    return s[0] === '"' ? inner.replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c)) : inner.replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  // solo números canónicos: «1.0» o «007» siguen siendo texto (si no, se reescribirían como 1 y 7)
  if (/^-?\d+(\.\d+)?$/.test(s) && String(Number(s)) === s) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitInline(inner).map(scalar);
  }
  return s;
}

function splitInline(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (const ch of s) {
    if (q) {
      cur += ch;
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseFrontmatter(text: string): ParsedDoc {
  const src = text.replace(/^﻿/, '');
  const m = /^---\r?\n/.exec(src);
  if (!m) return { data: {}, body: src, hasFrontmatter: false, errors: [] };
  const rest = src.slice(m[0].length);
  const end = /^---[ \t]*$/m.exec(rest);
  if (!end) return { data: {}, body: src, hasFrontmatter: true, errors: [t('frontmatter.sin_cerrar')] };
  const yaml = rest.slice(0, end.index);
  const body = rest.slice(end.index + end[0].length).replace(/^\r?\n/, '');
  const data: Frontmatter = {};
  const errors: string[] = [];
  let listKey: string | null = null;
  const blockLists = new Set<string>();
  yaml.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const item = /^\s+-\s*(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as FMValue[]).push(scalar(item[1]!));
      return;
    }
    const kv = /^([A-Za-z0-9_\-áéíóúñÁÉÍÓÚÑü .]+?):(?:\s+(.*))?$/.exec(line);
    if (!kv) {
      errors.push(t('frontmatter.linea_no_valida', { n: i + 2, text: line.trim().slice(0, 40) }));
      listKey = null;
      return;
    }
    const key = kv[1]!.trim();
    const val = kv[2] ?? '';
    if (val.trim() === '') {
      data[key] = [];
      listKey = key;
      blockLists.add(key);
    } else {
      data[key] = scalar(val);
      listKey = null;
    }
  });
  // "clave:" sin elementos debajo es nulo, no lista vacía
  for (const k of blockLists) if ((data[k] as FMValue[]).length === 0) data[k] = null;
  return { data, body, hasFrontmatter: true, errors };
}

function fmt(v: FMValue): string {
  if (v === null) return '';
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  if (typeof v === 'string') {
    // sin comillas solo si se vuelve a leer igual: no vacío, no empieza con «#» (comentario en YAML), ni
    // palabra reservada ni número canónico («1.0» y «007» se leen como texto: van sin comillas)
    const plain = v !== '' && /^[\w\-áéíóúñÁÉÍÓÚÑü #/.]*$/.test(v) && v.trim() === v && !v.startsWith('#') && !/^(true|false|null|~)$/.test(v) && !(/^-?\d+(\.\d+)?$/.test(v) && String(Number(v)) === v);
    return plain ? v : JSON.stringify(v);
  }
  return String(v);
}

export function stringifyFrontmatter(data: Frontmatter, body: string): string {
  const keys = Object.keys(data);
  if (!keys.length) return body;
  return `---\n${keys.map((k) => `${k}: ${fmt(data[k]!)}`.trimEnd()).join('\n')}\n---\n${body}`;
}

/**
 * Cambia solo las claves de `patch` (undefined = quitarla) y deja intactas las demás líneas del
 * frontmatter, también las que el parser no entiende (escalares de bloque, mapas anidados,
 * comentarios). Una clave ocupa su línea y las siguientes con sangría o «- » (lista de bloque).
 * Sin frontmatter (o sin cerrar), se antepone uno nuevo con las claves que tengan valor.
 */
export function setKeys(text: string, patch: Record<string, FMValue | undefined>): string {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const src = text.slice(bom.length);
  const open = /^---(\r?\n)/.exec(src);
  const end = open ? /^---[ \t]*$/m.exec(src.slice(open[0].length)) : null;
  const line = (k: string, v: FMValue) => `${k}: ${fmt(v)}`.trimEnd();
  if (!open || !end) {
    const add = Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => line(k, v!));
    return add.length ? `${bom}---\n${add.join('\n')}\n---\n${src}` : text;
  }
  const nl = open[1]!;
  const yamlText = src.slice(open[0].length, open[0].length + end.index);
  const tail = src.slice(open[0].length + end.index);
  const lines = yamlText === '' ? [] : yamlText.replace(/\r?\n$/, '').split(/\r?\n/);
  for (const [k, v] of Object.entries(patch)) {
    const at = lines.findIndex((l) => l.startsWith(`${k}:`) && /^\s*$|^\s/.test(l.slice(k.length + 1)));
    let to = at + 1;
    if (at >= 0) while (to < lines.length && /^(\s|-\s|-$)/.test(lines[to]!)) to++;
    if (v === undefined) { if (at >= 0) lines.splice(at, to - at); continue; }
    if (at >= 0) lines.splice(at, to - at, line(k, v));
    else lines.push(line(k, v));
  }
  if (!lines.length) return bom + tail.replace(/^---[ \t]*(\r?\n)?/, ''); // sin claves: sin frontmatter
  return `${bom}---${nl}${lines.map((l) => l + nl).join('')}${tail}`;
}
