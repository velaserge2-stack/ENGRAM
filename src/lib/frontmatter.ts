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
    return s[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
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
  if (typeof v === 'string') return /^[\w\-áéíóúñÁÉÍÓÚÑü #/.]*$/.test(v) && v.trim() === v && !/^(true|false|null|-?\d+(\.\d+)?)$/.test(v) ? v : JSON.stringify(v);
  return String(v);
}

export function stringifyFrontmatter(data: Frontmatter, body: string): string {
  const keys = Object.keys(data);
  if (!keys.length) return body;
  return `---\n${keys.map((k) => `${k}: ${fmt(data[k]!)}`.trimEnd()).join('\n')}\n---\n${body}`;
}
