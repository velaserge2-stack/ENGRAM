import { describe, expect, it } from 'vitest';
import { addTask, clearDone, editTask, isOverdue, moveTask, parseTasks, pendingCount, removeTask, setLevel, toggleTask } from '../src/tasks/parse';

const DOC = `---
tipo: tareas
---
# Tareas

Notas libres arriba.

- [ ] Leer cap. 3 📅 2026-11-20
- [x] Repasar ECG
  - [ ] subtarea A
  - [x] subtarea B
- [ ] Pedir libro
* [X] otra con asterisco

Texto al final.
`;

describe('Tareas (Prompt 19 · 2): formato Markdown', () => {
  it('lee casillas, nivel, fecha y texto; no confunde el resto', () => {
    const ts = parseTasks(DOC);
    expect(ts.map((t) => [t.level, t.done, t.text, t.due])).toEqual([
      [0, false, 'Leer cap. 3', '2026-11-20'],
      [0, true, 'Repasar ECG', null],
      [1, false, 'subtarea A', null],
      [1, true, 'subtarea B', null],
      [0, false, 'Pedir libro', null],
      [0, true, 'otra con asterisco', null],
    ]);
    expect(pendingCount(DOC)).toBe(3);
  });

  it('ida y vuelta: tachar dos veces deja el archivo igual (salvo normalizar la casilla)', () => {
    expect(toggleTask(toggleTask(DOC, 0), 0)).toBe(DOC);
    expect(toggleTask(DOC, 0)).toContain('- [x] Leer cap. 3 📅 2026-11-20');
    // solo cambia esa línea
    const a = DOC.split('\n'), b = toggleTask(DOC, 4).split('\n');
    expect(a.filter((l, n) => l !== b[n])).toEqual(['- [ ] Pedir libro']);
  });

  it('agregar: al final de la lista; en archivo vacío o sin lista, al final', () => {
    expect(parseTasks(addTask(DOC, 'Nueva', '2026-12-01')).pop()).toMatchObject({ text: 'Nueva', due: '2026-12-01', level: 0, done: false });
    expect(addTask(DOC, 'Nueva').split('\n')).toContain('- [ ] Nueva');
    expect(addTask(DOC, 'Nueva')).toContain('Texto al final.');
    expect(addTask('', 'Primera')).toBe('- [ ] Primera\n');
    expect(addTask('# Hola\n', 'x')).toBe('# Hola\n\n- [ ] x\n');
    expect(addTask('', '  con\nsalto  ')).toBe('- [ ] con salto\n');
  });

  it('editar texto y fecha; quitar la fecha', () => {
    expect(parseTasks(editTask(DOC, 0, 'Leer cap. 4', '2026-11-22'))[0]).toMatchObject({ text: 'Leer cap. 4', due: '2026-11-22' });
    expect(parseTasks(editTask(DOC, 0, 'Leer', null))[0]!.due).toBeNull();
  });

  it('borrar una tarea se lleva sus subtareas; borrar completadas', () => {
    expect(parseTasks(removeTask(DOC, 1)).map((t) => t.text)).toEqual(['Leer cap. 3', 'Pedir libro', 'otra con asterisco']);
    expect(parseTasks(clearDone(DOC)).map((t) => t.text)).toEqual(['Leer cap. 3', 'Pedir libro']);
    expect(clearDone(DOC)).toContain('Notas libres arriba.');
    expect(clearDone(clearDone(DOC))).toBe(clearDone(DOC)); // idempotente
  });

  it('reordenar entre hermanas, con subtareas; nunca cruza texto libre ni niveles', () => {
    const down = moveTask(DOC, 0, 1);
    expect(parseTasks(down).map((t) => t.text)).toEqual(['Repasar ECG', 'subtarea A', 'subtarea B', 'Leer cap. 3', 'Pedir libro', 'otra con asterisco']);
    expect(moveTask(down, 3, 0)).toBe(DOC); // y de vuelta
    expect(parseTasks(moveTask(DOC, 2, 3)).map((t) => t.text).slice(2, 4)).toEqual(['subtarea B', 'subtarea A']);
    expect(moveTask(DOC, 2, 4)).toBe(DOC); // subtarea ↔ tarea: no
    const sep = '- [ ] a\n\ntexto\n\n- [ ] b\n';
    expect(moveTask(sep, 0, 1)).toBe(sep);
  });

  it('sangría de un nivel y vencidas', () => {
    expect(parseTasks(setLevel(DOC, 4, 1))[4]!.level).toBe(1);
    expect(setLevel(DOC, 0, 1)).toBe(DOC); // la primera no puede ser subtarea
    const t = parseTasks(DOC)[0]!;
    expect(isOverdue(t, '2026-11-21')).toBe(true);
    expect(isOverdue(t, '2026-11-20')).toBe(false);
    expect(isOverdue({ ...t, done: true }, '2027-01-01')).toBe(false);
  });
});
