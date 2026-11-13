/**
 * «Compartir estadísticas» (Prompt 19 · 1): la imagen se compone con Canvas 2D propio (sin capturar la
 * pantalla ni librerías): el fondo activo (`paintBackground`, la misma cuenta que la capa de fondo), una
 * superficie de vidrio como la de la app y el texto con los colores del tema. El vidrio sube su opacidad
 * hasta que el texto secundario llega a 4.5:1 (`panelContrast`); el fondo nunca cambia de color.
 */
import { locale, t } from '../i18n';
import type { Background } from '../lib/settings';
import type { Framing } from '../lib/framing';
import { addDays, heatLevels, weekdayMon } from '../lib/days';
import { blurInto, glassAlpha, glassInk, panelContrast, paintBackground } from '../ui/background';
import { ellipsize, fmtDuration, SIZE, safeZone, type Format, type Period, type ShowKey, type Summary } from './period';

type Img = CanvasImageSource & { width: number; height: number };
type RGB = [number, number, number];

export interface CardInput {
  format: Format;
  period: Period;
  mode: 'dark' | 'light';
  /** intensidad del vidrio 0–1 (Ajustes) */
  k: number;
  bg: Background;
  /** fondo neutro (negro u blanco según el modo) en lugar del de la app */
  neutral: boolean;
  framing?: Framing;
  dim: number;
  /** desenfoque del fondo en px de pantalla (se escala al ancho de la imagen) */
  blur: number;
  viewportW: number;
  bgImg: Img | null;
  avatar: Img | null;
  mark: Img | null;
  profile: { name: string; username: string; emoji: string; initial: string; line: string };
  show: Record<ShowKey, boolean>;
  sum: Summary;
  font: string;
}

export interface CardResult {
  canvas: HTMLCanvasElement;
  /** opacidad final del vidrio y contraste (percentil 5) del texto principal y secundario */
  alpha: number;
  contrast: { t1: number; t2: number };
  empty: boolean;
  /** ¿lleva encabezado (foto/emoji/nombre/línea)? */
  head: boolean;
}

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Rango de fechas legible del periodo («7 – 13 nov 2026»). */
export function rangeLabel(sum: Summary, loc = locale()): string {
  const d = (k: string) => new Date(k + 'T12:00:00Z');
  const f = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return sum.from === sum.to ? f.format(d(sum.to)) : f.formatRange(d(sum.from), d(sum.to));
}

export function compose(i: CardInput): CardResult {
  const S = SIZE[i.format];
  const W = S.w, H = S.h;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const px = W / Math.max(320, i.viewportW); // px de pantalla → px de la imagen
  const g = glassInk(i.mode);

  // 1. fondo
  if (i.neutral) (ctx.fillStyle = i.mode === 'dark' ? '#000' : '#fff'), ctx.fillRect(0, 0, W, H);
  else paintBackground(ctx, i.bg, i.bgImg, W, H, { framing: i.framing, dim: i.dim, blur: i.blur * px });

  // 2. superficie de vidrio: el propio fondo desenfocado dentro del panel, velo, borde fino y brillo superior
  const z = safeZone(i.format);
  const R = Math.round(28 * 1.6);
  const panel = (c: CanvasRenderingContext2D) => (c.beginPath(), c.roundRect(z.x, z.y, z.w, z.h, R));
  const copy = Object.assign(document.createElement('canvas'), { width: W, height: H });
  copy.getContext('2d')!.drawImage(canvas, 0, 0);
  ctx.save();
  panel(ctx);
  ctx.clip();
  blurInto(ctx, copy, 28 * Math.max(0.15, i.k) * px * 1.4, 0, 0, W, H);
  ctx.restore();
  copy.width = copy.height = 0;
  // contraste: muestra del panel ya desenfocado, a 24 px por celda
  const cells: RGB[] = [];
  const step = 24;
  const data = ctx.getImageData(z.x, z.y, z.w, z.h).data;
  for (let y = step / 2; y < z.h; y += step) for (let x = step / 2; x < z.w; x += step) {
    const o = (Math.floor(y) * z.w + Math.floor(x)) * 4;
    cells.push([data[o]!, data[o + 1]!, data[o + 2]!]);
  }
  let alpha = glassAlpha(i.mode, i.k);
  let c = panelContrast(cells.slice(), i.mode, alpha);
  while (c.t2 < 4.5 && alpha < 0.96) c = panelContrast(cells.slice(), i.mode, (alpha = Math.min(0.96, alpha + 0.04)));
  ctx.save();
  panel(ctx);
  ctx.fillStyle = rgba(g.rgb, alpha);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = i.mode === 'dark' ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.65)';
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = i.mode === 'dark' ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.7)';
  ctx.fillRect(z.x, z.y, z.w, 2);
  ctx.restore();

  // 3. contenido
  const t1 = rgba(g.t1[0], g.t1[1]), t2 = rgba(g.t2[0], g.t2[1]);
  const font = (w: number, size: number) => `${w} ${Math.round(size)}px ${i.font}`;
  const sh = i.show;
  const sum = i.sum;
  const empty = !sum.cards && !sum.ms;
  const pad = 64;
  const innerW = z.w - 2 * pad;
  const loc = locale();
  const nf = new Intl.NumberFormat(loc);

  /** un bloque: alto a escala 1 y cómo dibujarse en (x, y) con escala s */
  type Block = { h: number; draw: (y: number, s: number) => void };
  const blocks: Block[] = [];

  // encabezado: avatar + líneas de texto (nombre, @usuario, carrera/lema), centradas en el avatar
  type HLine = { text: string; size: number; weight: number; color: string; lh: number };
  const hl: HLine[] = [];
  if (sh.name && i.profile.name.trim()) hl.push({ text: i.profile.name.trim(), size: 56, weight: 700, color: t1, lh: 66 });
  if (sh.user && i.profile.username) hl.push({ text: `@${i.profile.username}`, size: 34, weight: 500, color: t2, lh: 44 });
  if (sh.line && i.profile.line) hl.push({ text: i.profile.line, size: 32, weight: 400, color: t2, lh: 42 });
  const avatarOn = !!(sh.photo && (i.avatar || i.profile.emoji || i.profile.initial));
  const textH = hl.reduce((n, l) => n + l.lh, 0);
  const head = avatarOn || hl.length > 0;
  if (head) blocks.push({
    h: Math.max(avatarOn ? 132 : 0, textH),
    draw: (y, s) => {
      let x = z.x + pad * s;
      const A = 132 * s;
      const h = Math.max(avatarOn ? 132 : 0, textH) * s;
      if (avatarOn) {
        const ay = y + (h - A) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + A / 2, ay + A / 2, A / 2, 0, Math.PI * 2);
        ctx.fillStyle = i.mode === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.06)';
        ctx.fill();
        ctx.clip();
        if (i.avatar) {
          const k = Math.max(A / i.avatar.width, A / i.avatar.height);
          ctx.drawImage(i.avatar, x + (A - i.avatar.width * k) / 2, ay + (A - i.avatar.height * k) / 2, i.avatar.width * k, i.avatar.height * k);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = t1;
          ctx.font = font(i.profile.emoji ? 400 : 700, A * (i.profile.emoji ? 0.56 : 0.46));
          ctx.fillText(i.profile.emoji || i.profile.initial, x + A / 2, ay + A / 2 + (i.profile.emoji ? A * 0.03 : 0));
        }
        ctx.restore();
        x += A + 32 * s;
      }
      const maxW = z.x + z.w - pad * s - x;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      let ty = y + (h - textH * s) / 2;
      for (const l of hl) {
        ctx.font = font(l.weight, l.size * s);
        ctx.fillStyle = l.color;
        ctx.fillText(ellipsize(l.text, maxW, (q) => ctx.measureText(q).width), x, ty + (l.lh * 0.5 + l.size * 0.36) * s);
        ty += l.lh * s;
      }
    },
  });

  /** número grande que se encoge para caber en su columna */
  const fit = (text: string, w: number, size: number, weight = 700) => {
    ctx.font = font(weight, size);
    const m = ctx.measureText(text).width;
    if (m > w) ctx.font = font(weight, (size * w) / m);
  };

  if (empty) blocks.push({
    h: 150,
    draw: (y, s) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t1;
      fit(t('share.vacio'), z.w - 2 * pad * s, 46 * s, 600);
      ctx.fillText(t('share.vacio'), z.x + z.w / 2, y + 75 * s);
    },
  });
  else {
    const big = ([sh.hours && [fmtDuration(sum.ms, loc), t('share.horas_estudiadas')], sh.cards && [nf.format(sum.cards), t('share.flashcards_estudiadas')]].filter(Boolean) as [string, string][]);
    if (big.length) blocks.push({
      h: 190,
      draw: (y, s) => {
        const colW = (z.w - 2 * pad * s - (big.length - 1) * 40 * s) / big.length;
        big.forEach(([v, k], j) => {
          const x = z.x + pad * s + j * (colW + 40 * s);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = t1;
          fit(v, colW, 124 * s);
          ctx.fillText(v, x, y + 124 * s);
          ctx.fillStyle = t2;
          fit(k, colW, 34 * s, 500);
          ctx.fillText(k, x, y + 176 * s);
        });
      },
    });
    const small = ([
      sh.streak && [nf.format(sum.streak), t('share.racha_dias')],
      sh.days && [nf.format(sum.days), t('share.dias_estudiados')],
      sh.retention && sum.retention !== null && [`${nf.format(Math.round(sum.retention * 100))} %`, t('share.retencion')],
    ].filter(Boolean) as [string, string][]);
    if (small.length) blocks.push({
      h: 104,
      draw: (y, s) => {
        const colW = (z.w - 2 * pad * s - (small.length - 1) * 32 * s) / small.length;
        // separador fino arriba (jerarquía sin color)
        ctx.fillStyle = i.mode === 'dark' ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.08)';
        ctx.fillRect(z.x + pad * s, y - 20 * s, z.w - 2 * pad * s, 2);
        small.forEach(([v, k], j) => {
          const x = z.x + pad * s + j * (colW + 32 * s);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = t1;
          fit(v, colW, 60 * s);
          ctx.fillText(v, x, y + 60 * s);
          ctx.fillStyle = t2;
          fit(k, colW, 28 * s, 500);
          ctx.fillText(k, x, y + 100 * s);
        });
      },
    });
    if (sh.heat) {
      // mini mapa de adherencia: semanas del periodo (mín. 8, máx. 53), niveles por opacidad, sin color
      const span = Math.round((Date.parse(sum.to) - Date.parse(sum.from)) / 86_400_000) + 1;
      const weeks = Math.min(53, Math.max(8, Math.ceil((span + weekdayMon(sum.to)) / 7)));
      const cell = Math.min(34, innerW / (weeks * 1.2));
      const lv = heatLevels(sum.counts);
      const heat = i.mode === 'dark' ? '255,255,255' : '0,0,0';
      const OP = [0.08, 0.2, 0.35, 0.55, 0.85];
      blocks.push({
        h: cell * 1.2 * 7,
        draw: (y, s) => {
          const c2 = cell * s, gap = c2 * 0.2;
          const start = addDays(addDays(sum.to, -weekdayMon(sum.to)), -(weeks - 1) * 7);
          const x0 = z.x + (z.w - weeks * (c2 + gap) + gap) / 2;
          for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
            const day = addDays(start, w * 7 + d);
            if (day > sum.to) continue;
            const n = day < sum.from ? 0 : sum.counts.get(day) ?? 0;
            ctx.fillStyle = `rgba(${heat},${OP[lv(n)]})`;
            ctx.beginPath();
            ctx.roundRect(x0 + w * (c2 + gap), y + d * (c2 + gap), c2, c2, c2 * 0.24);
            ctx.fill();
          }
        },
      });
    }
  }

  // pie: marca (logo sin recuadro, teñido con el color de texto del tema) + «Engrama» + rango de fechas
  const markTint = (h: number) => {
    if (!i.mark) return null;
    const w = Math.round((i.mark.width * h) / i.mark.height);
    const m = Object.assign(document.createElement('canvas'), { width: w, height: Math.round(h) });
    const x = m.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(i.mark, 0, 0, w, m.height);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = rgba(g.t1[0], 1);
    x.fillRect(0, 0, w, m.height);
    return m;
  };
  const foot: Block = {
    h: sh.brand ? 112 : 36,
    draw: (y, s) => {
      const cx = z.x + z.w / 2;
      if (sh.brand) {
        const LH = 52 * s;
        const m = markTint(LH);
        ctx.font = font(500, LH / 0.72); // altura de mayúscula ≈ altura del símbolo
        if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${Math.round(2 * s)}px`;
        const tw = ctx.measureText('Engrama').width;
        const gap = 18 * s;
        const total = (m ? m.width + gap : 0) + tw;
        let x = cx - total / 2;
        if (m) (ctx.drawImage(m, x, y), (x += m.width + gap), (m.width = m.height = 0));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = rgba(g.t1[0], 1);
        ctx.fillText('Engrama', x, y + LH);
        if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = '0px';
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = t2;
      ctx.font = font(400, 28 * s);
      ctx.fillText(rangeLabel(sum, loc), cx, y + (sh.brand ? 104 : 28) * s);
    },
  };

  // reparto vertical: encabezado arriba, pie abajo, el resto centrado; todo encoge si no cabe (1:1)
  const minGap = 40;
  const top = head ? blocks.shift()! : null;
  const sumH = blocks.reduce((n, b) => n + b.h, 0) + (top?.h ?? 0) + foot.h;
  const nGaps = blocks.length + (top ? 1 : 0);
  const avail = z.h - 2 * pad;
  const s = Math.min(1, avail / (sumH + nGaps * minGap));
  const y0 = z.y + pad * s;
  if (top) top.draw(y0, s);
  const fy = z.y + z.h - pad * s - foot.h * s;
  foot.draw(fy, s);
  const midTop = y0 + (top ? (top.h + minGap) * s : 0);
  const midH = blocks.reduce((n, b) => n + b.h * s, 0);
  const free = fy - minGap * s - midTop - midH;
  const gap = blocks.length > 1 ? Math.min(150 * s, Math.max(minGap * s, free / (blocks.length + 1))) : 0;
  let y = midTop + Math.max(0, (free - gap * (blocks.length - 1)) / 2);
  for (const b of blocks) (b.draw(y, s), (y += b.h * s + gap));

  return { canvas, alpha, contrast: c, empty, head: !!head };
}

/** PNG (texto nítido); si pasa de 8 MB, JPEG de alta calidad. Suelta el canvas al terminar. */
export async function encode(canvas: HTMLCanvasElement): Promise<{ blob: Blob; ext: 'png' | 'jpg' }> {
  const to = (type: string, q?: number) => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(type))), type, q));
  let blob = await to('image/png');
  let ext: 'png' | 'jpg' = 'png';
  if (blob.size > 8 * 1024 * 1024) (blob = await to('image/jpeg', 0.92)), (ext = 'jpg');
  canvas.width = canvas.height = 0;
  return { blob, ext };
}
