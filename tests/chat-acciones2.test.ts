import { describe, expect, it } from 'vitest';
import { applySticky, applyTask, runAct, writes } from '../src/chat/actions';
import { applyProposal, forgetProposals, isBad, undoProposal, type Bad, type Proposal } from '../src/chat/proposal';
import { buildGo, buildPomo, buildSound, buildStudy, buildSticky, buildTask, makeActionTools, sectionOf, wantsAction, type ActionCtx } from '../src/chat/tools-actions';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const P = (x: Proposal | Bad): Proposal => { if (isBad(x)) throw new Error(x.error + ':' + x.detail); return x; };
const B = (x: Proposal | Bad): Bad => { if (!isBad(x)) throw new Error('debía fallar'); return x; };
const TASKS = '# Tareas\n\n- [ ] Leer cap 1\n- [ ] Resumen ECG 📅 2026-12-01\n- [x] Hecha\n';

describe('pomodoro / sonido / navegar', () => {
  it('valida argumentos y no escribe', () => {
    const p = P(buildPomo({ accion: 'iniciar', minutos: 25, etiqueta: 'ECG' }));
    expect(p.accion).toEqual({ k: 'pomo', op: 'iniciar', min: 25, label: 'ECG' });
    expect(writes(p.accion!)).toBe(false);
    expect(B(buildPomo({ accion: 'iniciar', minutos: 0 })).error).toBe('minutos');
    expect(B(buildPomo({ accion: 'iniciar', minutos: 999 })).error).toBe('minutos');
    expect(B(buildPomo({ accion: 'pausar', minutos: 5 })).error).toBe('minutos');
    expect(B(buildPomo({ accion: 'bailar' })).error).toBe('accion');
  });
  it('sonido: add-on apagado → error; nombre inexistente → lista; alias', () => {
    expect(B(buildSound(false, { accion: 'encender' })).detail).toBe('ambient');
    const e = B(buildSound(true, { accion: 'encender', sonidos: ['lluvia', 'truenos'] }));
    expect(e.error).toBe('sonido');
    expect(e.detail).toContain('rain');
    const p = P(buildSound(true, { accion: 'encender', sonidos: ['Lluvia', 'olas'], volumen: 40 }));
    expect(p.accion).toMatchObject({ k: 'sonido', levels: { rain: 0.6, waves: 0.6 }, vol: 0.4 });
    expect(B(buildSound(true, { accion: 'apagar', sonidos: ['rain'] })).error).toBe('sonidos');
    expect(B(buildSound(true, { accion: 'encender', volumen: 300 })).error).toBe('volumen');
  });
  it('ir_a: alias, inexistente → lista, bandeja requiere add-on', () => {
    expect(sectionOf('Estadísticas')).toBe('estadisticas');
    expect(sectionOf('stats')).toBe('estadisticas');
    expect(P(buildGo(false, { seccion: 'hoy' })).accion).toEqual({ k: 'ir', ruta: [] });
    expect(B(buildGo(false, { seccion: 'marte' })).detail).toContain('mazos');
    expect(B(buildGo(false, { seccion: 'bandeja' })).detail).toBe('inbox');
    expect(P(buildGo(true, { seccion: 'bandeja' })).accion).toEqual({ k: 'ir', ruta: ['bandeja'] });
  });
  it('estudiar: mazo, carpeta, tag; inexistente → lista de mazos', () => {
    const col = { decks: [{ full: 'Med/ECG', path: 'decks/Med/ECG.md', folder: 'Med', tags: ['cardio'] }, { full: 'Bio', path: 'decks/Bio.md', folder: '', tags: [] }] };
    expect(P(buildStudy(col, 'med/ecg')).accion).toEqual({ k: 'ir', ruta: ['estudiar', 'decks/Med/ECG.md'] });
    expect(P(buildStudy(col, 'ECG')).accion).toEqual({ k: 'ir', ruta: ['estudiar', 'decks/Med/ECG.md'] });
    expect(P(buildStudy(col, 'Med')).accion).toEqual({ k: 'ir', ruta: ['estudiar', 'decks/Med/'] });
    expect(P(buildStudy(col, 'tag:cardio')).accion).toEqual({ k: 'ir', ruta: ['estudiar', 'tag:cardio'] });
    expect(B(buildStudy(col, 'Química')).detail).toContain('Med/ECG');
    expect(B(buildStudy(null, 'x')).error).toBe('mazo');
  });
  it('wantsAction exige verbo y objeto', () => {
    expect(wantsAction('inicia un pomodoro de 25 minutos')).toBe(true);
    expect(wantsAction('abre estadísticas')).toBe(true);
    expect(wantsAction('enciende la lluvia')).toBe(true);
    expect(wantsAction('explícame la fibrilación')).toBe(false);
    expect(wantsAction('hola')).toBe(false);
  });
});

describe('tareas', () => {
  it('apagado → error; crear/completar/mover', () => {
    expect(B(buildTask(false, TASKS, { accion: 'crear', texto: 'x' })).detail).toBe('tasks');
    const c = P(buildTask(true, TASKS, { accion: 'crear', texto: 'Estudiar ECG', fecha: '2026-12-05' }));
    expect(c.contenido).toContain('- [ ] Estudiar ECG 📅 2026-12-05');
    expect(B(buildTask(true, TASKS, { accion: 'crear', texto: 'x', fecha: '5 de dic' })).error).toBe('fecha');
    expect(P(buildTask(true, TASKS, { accion: 'completar', texto: 'leer' })).contenido).toContain('- [x] Leer cap 1');
    const m = P(buildTask(true, TASKS, { accion: 'mover', texto: 'Resumen', antes_de: 'Leer' }));
    expect(m.contenido.indexOf('Resumen ECG')).toBeLessThan(m.contenido.indexOf('Leer cap 1'));
  });
  it('inexistente o ya hecha → error con la lista de pendientes', () => {
    const e = B(buildTask(true, TASKS, { accion: 'completar', texto: 'inventada' }));
    expect(e.error).toBe('tarea');
    expect(e.detail).toContain('Leer cap 1');
    expect(B(buildTask(true, TASKS, { accion: 'completar', texto: 'Hecha' })).error).toBe('tarea');
    expect(B(buildTask(true, '- [ ] a1\n- [ ] a2\n', { accion: 'completar', texto: 'a' })).error).toBe('varias');
    expect(B(buildTask(true, TASKS, { accion: 'mover', texto: 'Leer', antes_de: 'Leer' })).error).toBe('orden');
  });
  it('applyTask no pisa: se recalcula sobre el texto actual', () => {
    const o = { op: 'done', text: 'Leer cap 1' } as const;
    expect(applyTask(TASKS + '- [ ] Nueva\n', o)).toContain('- [x] Leer cap 1');
    expect(applyTask('- [ ] otra\n', o)).toBeNull();
  });
  it('aceptar y deshacer restauran el archivo exacto', async () => {
    forgetProposals();
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/Tareas.md', enc(TASKS));
    const p = P(buildTask(true, TASKS, { accion: 'completar', texto: 'Leer' }));
    await applyProposal(v, null, p, 7001);
    expect(dec(await v.read('notes/Tareas.md'))).toContain('- [x] Leer cap 1');
    await undoProposal(v, 7001);
    expect(dec(await v.read('notes/Tareas.md'))).toBe(TASKS);
  });
  it('si cambió Tareas.md y ya no hay tarea, no escribe', async () => {
    forgetProposals();
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/Tareas.md', enc(TASKS));
    const p = P(buildTask(true, TASKS, { accion: 'completar', texto: 'Leer' }));
    await v.write('notes/Tareas.md', enc('- [ ] otra\n'));
    await expect(applyProposal(v, null, p, 7002)).rejects.toThrow('gone');
    expect(dec(await v.read('notes/Tareas.md'))).toBe('- [ ] otra\n');
  });
});

describe('stickies', () => {
  const S1 = '---\nsticky: true\norden: 10\ncolor: amarillo\n---\nComprar tinta\nLlamar a Ana\n';
  const files = [{ path: 'notes/Stickies/aaa.md', text: S1 }];
  it('apagado → error; crear valida color y texto', () => {
    expect(B(buildSticky(false, [], { accion: 'crear', texto: 'x' })).detail).toBe('sticky-notes');
    expect(B(buildSticky(true, [], { accion: 'crear', texto: 'x', color: 'chartreuse' })).error).toBe('color');
    expect(B(buildSticky(true, [], { accion: 'crear', texto: '  ' })).error).toBe('texto');
    const p = P(buildSticky(true, files, { accion: 'crear', texto: 'Repasar\nlinea 2', color: 'rosa', fijada: true }, 1e12));
    expect(p.destino).toMatch(/^notes\/Stickies\/[a-z0-9]+\.md$/);
    expect(p.contenido).toContain('sticky: true');
    expect(p.contenido).toContain('orden: 20');
    expect(p.contenido).toContain('color: rosa');
  });
  it('editar: inexistente → lista; sin cambios → error; nunca vacía', () => {
    const e = B(buildSticky(true, files, { accion: 'editar', nombre: 'zzz', color: 'azul' }));
    expect(e.error).toBe('sticky');
    expect(e.detail).toContain('Comprar tinta');
    expect(B(buildSticky(true, files, { accion: 'editar', nombre: 'comprar' })).error).toBe('cambios');
    expect(B(buildSticky(true, files, { accion: 'editar', nombre: 'comprar', texto: '' })).error).toBe('texto');
    const p = P(buildSticky(true, files, { accion: 'editar', nombre: 'comprar', agregar: 'Sellos', archivada: true }));
    expect(p.contenido).toContain('Llamar a Ana\nSellos');
    expect(p.contenido).toContain('archivada: true');
  });
  it('crear y editar: aceptar y deshacer exactos', async () => {
    forgetProposals();
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/Stickies/aaa.md', enc(S1));
    const n = P(buildSticky(true, files, { accion: 'crear', texto: 'Nuevo' }, 1e12));
    await applyProposal(v, null, n, 7101);
    expect(await v.exists(n.destino)).toBe(true);
    await expect(applyProposal(v, null, n, 7102)).rejects.toThrow('exists');
    await undoProposal(v, 7101);
    expect(await v.exists(n.destino)).toBe(false); // a la papelera de notas, no borrado
    const e = P(buildSticky(true, files, { accion: 'editar', nombre: 'comprar', color: 'azul', texto: 'Otro texto' }));
    await applyProposal(v, null, e, 7103);
    expect(dec(await v.read('notes/Stickies/aaa.md'))).toContain('color: azul');
    await undoProposal(v, 7103);
    expect(dec(await v.read('notes/Stickies/aaa.md'))).toBe(S1);
    expect(applySticky('notes/Stickies/aaa.md', S1, { op: 'edit', pinned: true })).toContain('fijada: true');
  });
});

describe('herramientas y ejecución', () => {
  const ctx = (addons: string[], allowed = true) => {
    const got: Proposal[] = [];
    const c = { vault: new SafeVault(new MemoryBackend()), col: null, today: '2026-11-25', sources: [], allowed: () => allowed, propose: (p: Proposal) => got.push(p), addon: (id: string) => addons.includes(id) } as ActionCtx;
    return { c, got };
  };
  const run = (tl: Record<string, any>, name: string, args: unknown) => tl[name].execute(args, { toolCallId: 'x', messages: [] });
  it('no pedido → no propone; ofrece las seis', async () => {
    const { c, got } = ctx([], false);
    const tl = makeActionTools(c) as Record<string, any>;
    expect(Object.keys(tl).sort()).toEqual(['estudiar', 'ir_a', 'pomodoro', 'sonido_ambiente', 'stickies', 'tareas']);
    expect((await run(tl, 'pomodoro', { accion: 'iniciar' })).error).toContain('no pidió');
    expect(got).toHaveLength(0);
  });
  it('propone, avisa del add-on apagado y limita por turno', async () => {
    const { c, got } = ctx([]);
    const tl = makeActionTools(c) as Record<string, any>;
    expect((await run(tl, 'tareas', { accion: 'crear', texto: 'x' })).error).toContain('apagado');
    expect((await run(tl, 'stickies', { accion: 'crear', texto: 'x' })).error).toContain('apagado');
    expect(await run(tl, 'pomodoro', { accion: 'iniciar', minutos: 25 })).toHaveProperty('estado');
    await run(tl, 'ir_a', { seccion: 'notas' });
    await run(tl, 'ir_a', { seccion: 'mazos' });
    expect((await run(tl, 'ir_a', { seccion: 'hoy' })).error).toContain('Límite');
    expect(got).toHaveLength(3);
  });
  it('runAct: temporizador y navegación llaman a la app; sonido sin audio falla claro', () => {
    const calls: unknown[][] = [];
    const app = { pomo: { start: (...a: unknown[]) => calls.push(['start', ...a]), pause: () => calls.push(['pause']), reset: () => calls.push(['reset']) }, settings: { ambient: { levels: {}, background: false } }, update: () => undefined } as never;
    runAct({ k: 'pomo', op: 'iniciar', min: 30, label: 'ECG' }, app);
    runAct({ k: 'pomo', op: 'pausar' }, app);
    runAct({ k: 'pomo', op: 'detener' }, app);
    expect(calls).toEqual([['start', 'ECG', 30], ['pause'], ['reset']]);
    expect(() => runAct({ k: 'sonido', op: 'encender' }, app)).toThrow('nosupport');
  });
});
