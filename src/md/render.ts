/**
 * Markdown extendido (SPEC §4): tablas, tareas, callouts `> [!note]`, `[[wikilinks]]`,
 * `![[embeds]]`, `==resaltado==`, `[texto]{.color}` y cloze. Todo el HTML resultante
 * pasa por DOMPurify: los archivos pueden venir de terceros.
 */
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { StateCore, StateInline } from 'markdown-it';
import { IMG_EXT, parseEmbed } from './embed';

type MD = InstanceType<typeof MarkdownIt>;

const COLORS = new Set(['azul', 'verde', 'indigo', 'naranja', 'rosa', 'rojo', 'morado', 'turquesa', 'menta', 'amarillo']);
/** Prompt 17: tamaños relativos `[texto]{.grande}` y alineación de párrafo ` {.centro}` (listas cerradas). */
const SIZES = new Set(['pequeno', 'grande', 'muygrande']);
const ALIGN_END = /[ \t]*\{\.(centro|der|justificado)\}[ \t]*$/;
/** Clases que puede llevar el HTML de una nota; cualquier otra se descarta al sanitizar. */
const CLASS_OK = /^(callout|callout-t|wl|cloze|hidden|c-[a-z]+|t-(pequeno|grande|muygrande)|al-(centro|der|justificado)|language-[\w-]+)$/;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let md: MD | null = null;

function engine(): MD {
  if (md) return md;
  md = new MarkdownIt({ html: false, linkify: true, breaks: true });
  // ==resaltado==, [texto]{.color}, [[wikilink]], ![[embed]]
  md.inline.ruler.before('emphasis', 'engrama', (state: StateInline, silent: boolean) => {
    const src = state.src.slice(state.pos);
    let m: RegExpExecArray | null;
    if ((m = /^==([^=\n]+)==/.exec(src))) {
      if (!silent) state.push('html_inline', '', 0).content = `<mark>${md!.renderInline(m[1]!)}</mark>`;
    } else if ((m = /^\+\+(?=\S)([^+\n]*?[^\s+])\+\+/.exec(src)) && !/[\p{L}\p{N}_+]/u.test(state.src[state.pos - 1] ?? '')) {
      // ++subrayado++ (no en `c++`/`i++`: debe empezar fuera de una palabra; el código ya lo consumió antes)
      if (!silent) state.push('html_inline', '', 0).content = `<u>${md!.renderInline(m[1]!)}</u>`;
    } else if ((m = /^!\[\[([^\]\n]+)\]\]/.exec(src)) && (!m[1]!.includes('|') || IMG_EXT.test(m[1]!.split('|')[0]!.trim()))) {
      // `![[nota|alias]]` (no imagen) sigue como antes: «!» + enlace con alias
      if (!silent) {
        const e = parseEmbed(m[1]!);
        const name = e.name;
        // valores ya validados por parseEmbed (números finitos en rango, alineación de lista cerrada)
        const w = e.w ? ` width="${e.w.v}${e.w.unit === '%' ? '%' : ''}" data-w="${e.w.v}${e.w.unit === '%' ? '%' : ''}"` : '';
        const al = e.align ? ` data-align="${e.align}"` : '';
        state.push('html_inline', '', 0).content = IMG_EXT.test(name)
          ? `<img data-media="${esc(name)}" alt="${esc(e.alt ?? name)}"${w}${al}>`
          : /\.(mp3|m4a|wav|ogg)$/i.test(name)
            ? `<audio controls data-media="${esc(name)}"></audio>`
            : `<a class="wl" href="#/notas/${encodeURIComponent(name)}">${esc(name)}</a>`;
      }
    } else if ((m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src))) {
      if (!silent) state.push('html_inline', '', 0).content = `<a class="wl" data-wl="${esc(m[1]!.trim())}" href="#/notas/${encodeURIComponent(m[1]!.trim())}">${esc((m[2] ?? m[1]!).trim())}</a>`;
    } else if ((m = /^\[([^\]\n]+)\]\{((?:\.[a-z]+[ \t]*)+)\}/.exec(src)) && m[2]!.split(/\s+/).filter(Boolean).every((c) => COLORS.has(c.slice(1)) || SIZES.has(c.slice(1)))) {
      // [texto]{.color} y [texto]{.color .tamaño}; una clase desconocida deja todo literal
      const cls = m[2]!.split(/\s+/).filter(Boolean).map((c) => (COLORS.has(c.slice(1)) ? 'c-' : 't-') + c.slice(1));
      if (!silent) state.push('html_inline', '', 0).content = `<span class="${cls.join(' ')}">${md!.renderInline(m[1]!)}</span>`;
    } else return false;
    state.pos += m[0].length;
    return true;
  });
  // > [!note] Título  → callout
  md.core.ruler.after('inline', 'callout', (state: StateCore) => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      if (t[i]!.type !== 'blockquote_open') continue;
      const inline = t[i + 2];
      const m = inline?.type === 'inline' ? /^\[!(\w+)\]([+-]?)\s*(.*)/.exec(inline.content) : null;
      if (!m) continue;
      t[i]!.attrSet('class', 'callout');
      t[i]!.attrSet('data-kind', m[1]!.toLowerCase());
      const folded = m[2] === '-';
      if (folded) {
        // plegable: <details><summary>…</summary>…</details>
        t[i]!.tag = 'details';
        let depth = 0;
        for (let j = i; j < t.length; j++) {
          if (t[j]!.type === 'blockquote_open') depth++;
          if (t[j]!.type === 'blockquote_close' && --depth === 0) {
            t[j]!.tag = 'details';
            break;
          }
        }
        if (t[i + 1]?.type === 'paragraph_open') t[i + 1]!.hidden = true;
        if (t[i + 3]?.type === 'paragraph_close') t[i + 3]!.hidden = true;
      }
      const title = m[3]!.split('\n')[0] || m[1]!;
      const rest = inline!.content.split('\n').slice(1).join('\n');
      inline!.children = [];
      const tok = new state.Token('html_inline', '', 0);
      tok.content = folded ? `<summary class="callout-t">${esc(title)}</summary>${rest ? '<p>' + md!.renderInline(rest) + '</p>' : ''}` : `<span class="callout-t">${esc(title)}</span>${rest ? '<br>' + md!.renderInline(rest) : ''}`;
      inline!.children.push(tok);
    }
  });
  // - [ ] tareas
  md.core.ruler.after('inline', 'tasks', (state: StateCore) => {
    for (const tok of state.tokens) {
      if (tok.type !== 'inline' || !tok.children?.length) continue;
      const first = tok.children[0]!;
      const m = first.type === 'text' ? /^\[([ xX])\]\s/.exec(first.content) : null;
      if (!m) continue;
      first.content = first.content.slice(m[0].length);
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> `;
      tok.children.unshift(box);
    }
  });
  // alineación de párrafo o título: ` {.centro}` al final → clase en el bloque (se quita del texto)
  md.core.ruler.after('inline', 'align', (state: StateCore) => {
    const t = state.tokens;
    for (let i = 1; i < t.length; i++) {
      const tok = t[i]!;
      const open = t[i - 1]!;
      // `hidden`: párrafo interno de un elemento de lista (ahí la marca queda literal)
      if (tok.type !== 'inline' || (open.type !== 'paragraph_open' && open.type !== 'heading_open') || open.hidden || !ALIGN_END.test(tok.content)) continue;
      const last = tok.children?.[tok.children.length - 1];
      if (!last || last.type !== 'text' || !ALIGN_END.test(last.content)) continue;
      open.attrJoin('class', `al-${ALIGN_END.exec(last.content)![1]}`);
      last.content = last.content.replace(ALIGN_END, '');
    }
  });
  return md;
}

// solo clases de la lista cerrada (el Markdown no admite HTML, pero el HTML importado de .docx sí pasa por aquí)

const PURIFY = {
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|blob|media):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  // solo estos data-*; nunca `style` en línea (Notas-Pro · A3)
  ADD_ATTR: ['data-media', 'data-wl', 'data-kind', 'data-w', 'data-align', 'target'],
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ['style'],
  FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed'],
  ADD_TAGS: ['details', 'summary'],
};

/**
 * Prompt 14: instancia propia con la configuración fijada una vez. Pasar la configuración en cada
 * llamada obligaba a DOMPurify a volver a procesarla (y clonar sus listas) en cada bloque: era la
 * mitad del tiempo de renderizar una nota. Mismas reglas, mismo resultado.
 */
let purify: ReturnType<typeof DOMPurify> | null = null;
export function sanitize(html: string): string {
  if (!purify) {
    purify = DOMPurify();
    purify.setConfig(PURIFY);
    // solo clases de la lista cerrada (Prompt 17), en la misma instancia que sanea (Prompt 14)
    purify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName !== 'class') return;
      const keep = data.attrValue.split(/\s+/).filter((c) => CLASS_OK.test(c));
      if (keep.length) data.attrValue = keep.join(' ');
      else data.keepAttr = false;
    });
  }
  return purify.sanitize(html) as string;
}

export function renderMarkdown(text: string): string {
  return sanitize(engine().render(text));
}

/**
 * HTML ya sanitizado por texto de bloque (LRU). Un bloque que no cambió no se vuelve a convertir
 * ni a sanear: escribir en una nota de 3 000 bloques ya no rehace los otros 2 999. Guarda la salida
 * de `renderMarkdown`, así que todo lo que sale de aquí pasó por DOMPurify.
 */
const LRU_MAX = 20000;
const lru = new Map<string, string>();
export function renderMarkdownCached(text: string): string {
  const hit = lru.get(text);
  if (hit !== undefined) {
    lru.delete(text);
    lru.set(text, hit);
    return hit;
  }
  const html = renderMarkdown(text);
  lru.set(text, html);
  if (lru.size > LRU_MAX) lru.delete(lru.keys().next().value!);
  return html;
}
export const renderCacheSize = () => lru.size;

export function renderInline(text: string): string {
  return sanitize(engine().renderInline(text));
}

/** Cloze: oculta el número `n` (con pista) y muestra el resto; `reveal` lo resalta. */
export function clozeText(text: string, n: number, reveal: boolean): string {
  return text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (_, num: string, ans: string, hint?: string) => {
    if (Number(num) !== n && n !== -1) return ans;
    return reveal ? `⟦c⟧${ans}⟦/c⟧` : `⟦h⟧${hint ? hint : '…'}⟦/h⟧`;
  });
}

export function renderCloze(text: string, n: number, reveal: boolean): string {
  const html = renderMarkdown(clozeText(text, n, reveal));
  return html
    .replace(/⟦c⟧/g, '<span class="cloze">').replace(/⟦\/c⟧/g, '</span>')
    .replace(/⟦h⟧/g, '<span class="cloze hidden">[').replace(/⟦\/h⟧/g, ']</span>');
}

/** Texto plano (para voz, búsqueda y comparar). */
export function plainText(text: string): string {
  return text
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
    .replace(/\[([^\]]+)\]\{(?:\.[a-z]+\s*)+\}/g, '$1')
    .replace(/\+\+(\S[^+\n]*?)\+\+/g, '$1')
    .replace(/\s*\{\.(centro|der|justificado)\}\s*$/gm, '')
    .replace(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/[*_=`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
