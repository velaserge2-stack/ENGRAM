/**
 * Mosaico «Tareas» de Hoy (Prompt 19 · 2). Add-on `tasks`, apagado por defecto: este archivo solo se
 * carga con `import()` cuando está activo. El archivo `notes/Tareas.md` es la fuente de verdad y se
 * escribe por `noteStore` (el mismo documento que abre Notas; guardado con SafeVault). Nada se
 * reescribe hasta que el usuario edita.
 */
import { t, tn } from '../i18n';
import { AlertCircle, CalendarDays, GripVertical, IndentIncrease, IndentDecrease, Pencil, Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { Segmented } from '../ui/kit';
import { noteStore } from '../notes/store';
import { addTask, clearDone, editTask, isOverdue, moveTask, parseTasks, pendingCount, removeTask, setLevel, TASKS_PATH, toggleTask, type Task } from './parse';

/** El texto del archivo, sincronizado con cualquier otra vista de la misma nota. */
function useTasksText(): [string | null, (next: string) => void] {
  const app = useApp();
  const [text, setText] = useState<string | null>(noteStore.peek(TASKS_PATH));
  useEffect(() => {
    let alive = true;
    void noteStore.load(app.vault, TASKS_PATH).then((x) => alive && setText(x));
    const off = noteStore.subscribe(app.vault, TASKS_PATH, setText);
    return () => ((alive = false), off());
  }, [app.version]);
  return [text, (next) => noteStore.set(app.vault, TASKS_PATH, next)];
}

/** Sin interfaz: informa el número de pendientes (para el contador de la bandeja). */
export function TasksCount(p: { onCount: (n: number) => void }) {
  const [text] = useTasksText();
  useEffect(() => p.onCount(text ? pendingCount(text) : 0), [text]);
  return null;
}

type Filter = 'todas' | 'pendientes' | 'hechas';

export function TasksTile(p: { today: string }) {
  const app = useApp();
  const [text, write] = useTasksText();
  const [filter, setFilter] = useState<Filter>('todas');
  const [draft, setDraft] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<number | null>(null);
  const tasks = text ? parseTasks(text) : [];
  const pend = tasks.filter((x) => !x.done).length;
  const done = tasks.length - pend;

  // después de reordenar con el teclado, el foco sigue a la tarea
  useEffect(() => {
    if (focusAfter.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${focusAfter.current}"] input[type=checkbox]`)?.focus();
    focusAfter.current = null;
  });

  const change = (next: string, undoMsg?: string) => {
    const prev = text ?? '';
    if (next === prev) return;
    write(next);
    if (undoMsg) app.toast(undoMsg, { label: t('tasks.deshacer'), run: () => write(prev) });
  };
  const add = (e: Event) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    // si algo falla, el texto escrito se conserva
    try {
      change(addTask(text ?? '', body, draftDue || null));
      setDraft('');
      setDraftDue('');
    } catch (err) {
      console.error(err);
      app.toast(t('tasks.no_se_guardo'));
    }
  };

  /** Qué se ve: en «Todas», las hechas de primer nivel bajan a su propio bloque (el archivo no cambia). */
  const groups: Task[][] = [];
  for (const x of tasks) if (x.level === 0 || !groups.length) groups.push([x]); else groups[groups.length - 1]!.push(x);
  const show = (g: Task[]) => (filter === 'pendientes' ? !g[0]!.done || g.some((s) => !s.done) : filter === 'hechas' ? g[0]!.done || g.some((s) => s.done) : true);
  const open = groups.filter((g) => !g[0]!.done && show(g));
  const closed = groups.filter((g) => g[0]!.done && show(g));

  const onKey = (e: KeyboardEvent, x: Task) => {
    if (editing !== null) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-i] input[type=checkbox]') ?? [])];
    const at = rows.findIndex((r) => r === document.activeElement);
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey) {
      e.preventDefault();
      const sib = tasks.filter((s) => s.level === x.level);
      const k = sib.findIndex((s) => s.i === x.i) + (e.key === 'ArrowUp' ? -1 : 1);
      const to = sib[k];
      if (!to) return;
      const next = moveTask(text ?? '', x.i, to.i);
      if (next === text) return;
      // la tarea queda donde estaba su vecina (más/menos sus subtareas)
      focusAfter.current = parseTasks(next).findIndex((s, n) => s.text === x.text && s.level === x.level && Math.abs(n - to.i) <= 3);
      change(next);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowUp' ? -1 : 1)))]?.focus();
    } else if (e.key === 'Delete') {
      e.preventDefault();
      change(removeTask(text ?? '', x.i), t('tasks.borrada'));
      rows[Math.min(at, rows.length - 2)]?.focus();
    }
  };

  // arrastrar desde el asa (Pointer Events con captura): se suelta sobre la fila de destino
  const startDrag = (e: PointerEvent, x: Task) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from: x.i, over: x.i });
  };
  const moveDrag = (e: PointerEvent) => {
    if (!drag) return;
    const row = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.('[data-i]')).find(Boolean) as HTMLElement | undefined;
    const over = row ? Number(row.dataset.i) : drag.over;
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const endDrag = () => {
    if (drag && drag.over !== drag.from) change(moveTask(text ?? '', drag.from, drag.over));
    setDrag(null);
  };

  const row = (x: Task) => {
    const late = isOverdue(x, p.today);
    if (editing === x.i) return <EditRow key={x.i} task={x} onCancel={() => setEditing(null)} onSave={(body, due) => (change(editTask(text ?? '', x.i, body, due)), setEditing(null))} />;
    return (
      <li key={`${x.i}:${x.text}`} data-i={x.i} class={`task${x.done ? ' done' : ''}${x.level ? ' sub' : ''}${drag?.over === x.i && drag.from !== x.i ? ' drop' : ''}${drag?.from === x.i ? ' dragging' : ''}`} onKeyDown={(e) => onKey(e, x)}>
        <button type="button" class="btn icon grip" aria-label={t('tasks.mover', { task: x.text })} onPointerDown={(e) => startDrag(e, x)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}><GripVertical size={16} /></button>
        <label class="task-check">
          <input type="checkbox" checked={x.done} onChange={() => ((focusAfter.current = x.i), change(toggleTask(text ?? '', x.i)))} />
          <span class="tx-wrap">
            <span class="tx" data-user-content>{x.text || '—'}</span>
            {x.due && <span class={`due num${late ? ' late' : ''}`}>{late ? <AlertCircle size={14} aria-hidden="true" /> : <CalendarDays size={14} aria-hidden="true" />} {late ? t('tasks.vencida', { date: x.due }) : x.due}</span>}
          </span>
        </label>
        <button type="button" class="btn icon" onClick={() => setEditing(x.i)} aria-label={t('tasks.editar', { task: x.text })}><Pencil size={16} /></button>
        {x.level ? <button type="button" class="btn icon" aria-label={t('tasks.quitar_sangria')} onClick={() => change(setLevel(text ?? '', x.i, 0))}><IndentDecrease size={16} /></button>
          : x.i > 0 && <button type="button" class="btn icon" aria-label={t('tasks.hacer_subtarea')} onClick={() => change(setLevel(text ?? '', x.i, 1))}><IndentIncrease size={16} /></button>}
        <button type="button" class="btn icon" aria-label={t('tasks.borrar', { task: x.text })} onClick={() => change(removeTask(text ?? '', x.i), t('tasks.borrada'))}><Trash2 size={16} /></button>
      </li>
    );
  };

  return (
    <section class="glass panel tasks" aria-label={t('tasks.tareas')}>
      <div class="panel-h wrap">
        <h2>{t('tasks.tareas')} <span class="t2 note num">{tn('tasks.n_pendientes', pend)}</span></h2>
        <Segmented label={t('tasks.filtro')} value={filter} onChange={setFilter} options={[['todas', t('tasks.todas')], ['pendientes', t('tasks.pendientes')], ['hechas', t('tasks.hechas')]]} />
      </div>
      <form class="row wrap task-add" onSubmit={add}>
        <input class="input" value={draft} placeholder={t('tasks.anadir_placeholder')} aria-label={t('tasks.anadir_placeholder')} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} />
        <input class="input" type="date" value={draftDue} aria-label={t('tasks.fecha')} onInput={(e) => setDraftDue((e.target as HTMLInputElement).value)} />
        <button type="submit" class="btn primary" disabled={!draft.trim()}>{t('tasks.anadir')}</button>
      </form>
      {text === null ? null : !tasks.length ? <p class="foot">{t('tasks.vacio')}</p> : (
        <ul class="task-list" ref={list}>
          {open.flat().map(row)}
          {closed.length > 0 && filter === 'todas' && <li class="task-sep foot" aria-hidden="true">{tn('tasks.n_hechas', done)}</li>}
          {closed.flat().map(row)}
        </ul>
      )}
      {done > 0 && <div class="row" style={{ justifyContent: 'flex-end', marginTop: '8px' }}><button type="button" class="btn" onClick={() => confirm(t('tasks.confirmar_borrar_hechas', { n: done })) && change(clearDone(text ?? ''), t('tasks.hechas_borradas'))}>{t('tasks.borrar_completadas')}</button></div>}
    </section>
  );
}

function EditRow(p: { task: Task; onSave: (body: string, due: string | null) => void; onCancel: () => void }) {
  const [body, setBody] = useState(p.task.text);
  const [due, setDue] = useState(p.task.due ?? '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <li class={`task editing${p.task.level ? ' sub' : ''}`}>
      <form class="row wrap" style={{ flex: '1' }} onSubmit={(e) => (e.preventDefault(), body.trim() && p.onSave(body, due || null))} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), p.onCancel())}>
        <input ref={ref} class="input" value={body} aria-label={t('tasks.texto')} onInput={(e) => setBody((e.target as HTMLInputElement).value)} />
        <input class="input" type="date" value={due} aria-label={t('tasks.fecha')} onInput={(e) => setDue((e.target as HTMLInputElement).value)} />
        <button type="submit" class="btn primary" disabled={!body.trim()}>{t('tasks.guardar')}</button>
        <button type="button" class="btn" onClick={p.onCancel}>{t('tasks.cancelar')}</button>
      </form>
    </li>
  );
}
