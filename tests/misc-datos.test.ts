import { describe, expect, it } from 'vitest';
import { moveTask, toggleTask, parseTasks, addTask } from '../src/tasks/parse';
import { safeSegment } from '../src/notes/model';

describe('barrido datos', () => {
  const crlf = '# T\r\n\r\n- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n';
  it('moveTask funciona con CRLF', () => {
    expect(moveTask(crlf, 0, 2)).not.toBe(crlf);
    expect(parseTasks(moveTask(crlf, 0, 2)).map((t) => t.text)).toEqual(['b', 'c', 'a']);
  });
  it('editar una tarea CRLF conserva el fin de línea', () => {
    expect(toggleTask(crlf, 1)).toBe('# T\r\n\r\n- [ ] a\r\n- [x] b\r\n- [ ] c\r\n');
  });
  it('addTask en archivo CRLF usa CRLF', () => {
    expect(addTask(crlf, 'd')).toBe('# T\r\n\r\n- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n- [ ] d\r\n');
  });
  it('tarea con BOM al inicio se reconoce', () => {
    expect(parseTasks('﻿- [ ] a\n')).toHaveLength(1);
  });
  it('safeSegment quita caracteres de control', () => {
    expect(safeSegment('a\u0000b\u0007c')).toBe('a b c');
  });
});
