import { locale, t } from '../i18n';
import { Activity, BookOpen, CircleDot, ClipboardCheck, GraduationCap } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EventKind, StudyBlock } from '../lib/ics';

/** Tipos de entrada (F16): se distinguen por icono y texto, nunca por color. */
export const KIND_ICON: Record<EventKind, (p: { size?: number }) => preact.JSX.Element> = {
  clase: (p) => <GraduationCap size={p.size ?? 14} aria-hidden="true" />,
  actividad: (p) => <Activity size={p.size ?? 14} aria-hidden="true" />,
  estudio: (p) => <BookOpen size={p.size ?? 14} aria-hidden="true" />,
  examen: (p) => <ClipboardCheck size={p.size ?? 14} aria-hidden="true" />,
  otro: (p) => <CircleDot size={p.size ?? 14} aria-hidden="true" />,
};
export const kindLabel = (k: EventKind) => t(`cal.kind_${k}`);

export interface GridItem { date: string; start: number; end: number; b: StudyBlock }

const HOUR = 44; // px por hora
const SNAP = 15; // minutos
const minOf = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type Drag =
  | { kind: 'new'; date: string; a: number; b: number }
  | { kind: 'move' | 'size'; item: GridItem; y0: number; date: string; a: number; b: number; moved: boolean };

/**
 * Semana y día con horas (F16): tocar una franja crea una entrada de 1 h; arrastrar en vacío
 * fija la duración; arrastrar una entrada la mueve (de hora y de día); el asa inferior cambia
 * la duración. Pointer Events (el arrastrar HTML5 no es fiable en iOS); pasos de 15 min.
 */
export function TimeGrid(p: { days: string[]; items: GridItem[]; today: string; onSlot: (date: string, a: number, b: number) => void; onOpen: (it: GridItem) => void; onChange: (it: GridItem, date: string, a: number, b: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR; }, []);
  const yMin = (e: PointerEvent, el: HTMLElement) => Math.max(0, Math.min(24 * 60 - SNAP, Math.round(((e.clientY - el.getBoundingClientRect().top) / HOUR) * 60 / SNAP) * SNAP));
  const colAt = (e: PointerEvent) => (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-col]')?.dataset.col;
  const timed = p.items.filter((x) => !x.b.allDay);
  const allDay = p.items.filter((x) => x.b.allDay);

  const lanes = (items: GridItem[]) => {
    const sorted = [...items].sort((a, b) => a.start - b.start);
    const ends: number[] = [];
    const lane = new Map<GridItem, number>();
    for (const it of sorted) {
      let k = ends.findIndex((e) => e <= it.start);
      if (k < 0) k = ends.push(0) - 1;
      ends[k] = it.end;
      lane.set(it, k);
    }
    return { lane, n: Math.max(1, ends.length) };
  };

  return (
    <div class="tgrid" style={{ '--cols': String(p.days.length) }}>
      <div class="tg-head">
        <span />
        {p.days.map((d) => <span class={`tg-day${d === p.today ? ' today' : ''}`}>{new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'))}</span>)}
      </div>
      {allDay.length > 0 && (
        <div class="tg-allday">
          <span class="foot">{t('cal.todo_el_dia')}</span>
          {p.days.map((d) => <span>{allDay.filter((x) => x.date === d).map((x) => <button type="button" class="ev" onClick={() => p.onOpen(x)}>{x.b.kind && KIND_ICON[x.b.kind]({})} {x.b.title}</button>)}</span>)}
        </div>
      )}
      <div class="tg-body" ref={scroller}>
        <div class="tg-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, h) => <span style={{ height: `${HOUR}px` }}>{hm(h * 60)}</span>)}</div>
        {p.days.map((d) => {
          const mine = timed.filter((x) => x.date === d);
          const { lane, n } = lanes(mine);
          return (
            <div class="tg-col" data-col={d} style={{ height: `${24 * HOUR}px` }} role="group" aria-label={d}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('.tg-ev')) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const m = yMin(e as PointerEvent, e.currentTarget as HTMLElement);
                setDrag({ kind: 'new', date: d, a: m, b: m });
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                const col = (drag.kind === 'new' ? e.currentTarget : document.querySelector<HTMLElement>(`[data-col="${drag.date}"]`)) as HTMLElement;
                const m = yMin(e as PointerEvent, col);
                if (drag.kind === 'new') return setDrag({ ...drag, b: m });
                const dm = Math.round((((e as PointerEvent).clientY - drag.y0) / HOUR) * 60 / SNAP) * SNAP;
                const s0 = minOf(drag.item.start), e0 = s0 + Math.round((drag.item.end - drag.item.start) / 60000);
                const date = drag.kind === 'move' ? colAt(e as PointerEvent) ?? drag.date : drag.date;
                if (drag.kind === 'move') setDrag({ ...drag, date, a: Math.max(0, s0 + dm), b: Math.max(0, s0 + dm) + (e0 - s0), moved: drag.moved || Math.abs(dm) >= SNAP || date !== drag.item.date });
                else setDrag({ ...drag, b: Math.max(s0 + SNAP, e0 + dm), moved: drag.moved || Math.abs(dm) >= SNAP });
              }}
              onPointerUp={() => {
                if (!drag) return;
                setDrag(null);
                if (drag.kind === 'new') {
                  const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
                  p.onSlot(drag.date, a, b - a < SNAP ? a + 60 : b + SNAP);
                } else if (drag.moved) p.onChange(drag.item, drag.date, drag.a, drag.b);
                else p.onOpen(drag.item);
              }}>
              {Array.from({ length: 24 }, (_, h) => <i class="tg-line" style={{ top: `${h * HOUR}px` }} />)}
              {mine.map((it) => {
                const ghost = drag && drag.kind !== 'new' && drag.item === it;
                if (ghost && drag.date !== d) return null;
                const a = ghost ? drag.a : minOf(it.start);
                const b = ghost ? drag.b : a + Math.round((it.end - it.start) / 60000);
                const L = lane.get(it)!;
                const ro = !!it.b.readonly;
                return (
                  <div class={`tg-ev${it.b.done.includes(d) ? ' done' : ''}${ghost ? ' lift' : ''}${ro ? ' ro' : ''}`} style={{ top: `${(a / 60) * HOUR}px`, height: `${Math.max(18, ((b - a) / 60) * HOUR - 2)}px`, left: `${(L / n) * 100}%`, width: `${100 / n}%` }}
                    role="button" tabIndex={0} aria-label={`${it.b.kind ? kindLabel(it.b.kind) + ': ' : ''}${it.b.title}, ${hm(a)}–${hm(b)}`}
                    onKeyDown={(e) => e.key === 'Enter' && p.onOpen(it)}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (ro) return p.onOpen(it);
                      const col = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-col]')!;
                      col.setPointerCapture(e.pointerId);
                      const size = (e.target as HTMLElement).classList.contains('tg-size');
                      setDrag({ kind: size ? 'size' : 'move', item: it, y0: e.clientY, date: d, a, b, moved: false });
                    }}>
                    <span class="tg-t">{it.b.kind && KIND_ICON[it.b.kind]({ size: 12 })} {hm(a)} <b>{it.b.title}</b></span>
                    {it.b.location && <span class="tg-loc">{it.b.location}</span>}
                    {!ro && <i class="tg-size" aria-hidden="true" />}
                  </div>
                );
              })}
              {drag?.kind === 'new' && drag.date === d && <div class="tg-ev lift ghost" style={{ top: `${(Math.min(drag.a, drag.b) / 60) * HOUR}px`, height: `${Math.max(HOUR / 4, ((Math.abs(drag.b - drag.a) + SNAP) / 60) * HOUR)}px`, left: 0, width: '100%' }}><span class="tg-t">{hm(Math.min(drag.a, drag.b))}–{hm(Math.max(drag.a, drag.b) + SNAP)}</span></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
