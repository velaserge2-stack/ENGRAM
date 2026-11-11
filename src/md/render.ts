/**
 * Markdown extendido (SPEC §4): tablas, tareas, callouts `> [!note]`, `[[wikilinks]]`,
 * `![[embeds]]`, `==resaltado==`, `[texto]{.color}` y cloze. Todo el HTML resultante
 * pasa por DOMPurify: los archivos pueden venir de terceros.
 */
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { StateCore, StateInline } from 'markdown-it';

type MD = InstanceType<typeof MarkdownIt>;

const COLORS = new Set(['azul', 'verde', 'indigo', 'naranja', 'rosa', 'rojo', 'morado', 'turquesa', 'menta', 'amarillo']);

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
    } else if ((m = /^!\[\[([^\]|\n]+)(?:\|(\d+))?\]\]/.exec(src))) {
      if (!silent) {
        const name = m[1]!.trim();
        const w = m[2] ? ` width="${m[2]}"` : '';
        state.push('html_inline', '', 0).content = /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(name)
          ? `<img data-media="${esc(name)}" alt="${esc(name)}"${w}>`
          : /\.(mp3|m4a|wav|ogg)$/i.test(name)
            ? `<audio controls data-media="${esc(name)}"></audio>`
            : `<a class="wl" href="#/notas/${encodeURIComponent(name)}">${esc(name)}</a>`;
      }
    } else if ((m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/.exec(src))) {
      if (!silent) state.push('html_inline', '', 0).content = `<a class="wl" data-wl="${esc(m[1]!.trim())}" href="#/notas/${encodeURIComponent(m[1]!.trim())}">${esc((m[2] ?? m[1]!).trim())}</a>`;
    } else if ((m = /^\[([^\]\n]+)\]\{\.([a-z]+)\}/.exec(src)) && COLORS.has(m[2]!)) {
      if (!silent) state.push('html_inline', '', 0).content = `<span class="c-${m[2]}">${md!.renderInline(m[1]!)}</span>`;
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
      const m = inline?.type === 'inline' ? /^\[!(\w+)\][+-]?\s*(.*)/.exec(inline.content) : null;
      if (!m) continue;
      t[i]!.attrSet('class', 'callout');
      t[i]!.attrSet('data-kind', m[1]!.toLowerCase());
      const title = m[2]!.split('\n')[0] || m[1]!;
      const rest = inline!.content.split('\n').slice(1).join('\n');
      inline!.children = [];
      const tok = new state.Token('html_inline', '', 0);
      tok.content = `<span class="callout-t">${esc(title)}</span>${rest ? '<br>' + md!.renderInline(rest) : ''}`;
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
  return md;
}

const PURIFY = {
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|blob):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  ADD_ATTR: ['data-media', 'data-wl', 'data-kind', 'target'],
  FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed'],
};

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, PURIFY) as string;
}

export function renderMarkdown(text: string): string {
  return sanitize(engine().render(text));
}

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
    .replace(/\[([^\]]+)\]\{\.[a-z]+\}/g, '$1')
    .replace(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/[*_=`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
