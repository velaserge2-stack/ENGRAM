import { describe, expect, it } from 'vitest';
import { autoPurgeBanks, BANK_TRASH, listBankTrash, purgeBank, restoreBank, trashBank } from '../src/sim/banktrash';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { readTextOr } from '../src/vault/util';

const BANK = '---\nexamen: Cardio\n---\n1. ¿Pregunta?\n   A) Sí *\n   B) No\n';
const P = 'exams-bank/Cardiología parcial.md';
const vault = async (files: Record<string, string> = { [P]: BANK }) => {
  const v = new SafeVault(new MemoryBackend());
  for (const [p, t] of Object.entries(files)) await v.write(p, t);
  return v;
};

describe('papelera de bancos', () => {
  it('mueve el archivo (acentos y espacios) con su meta; el original desaparece', async () => {
    const v = await vault();
    const e = await trashBank(v, { path: P, name: 'Cardio', questions: 1 }, 1000);
    expect(await v.exists(P)).toBe(false);
    expect(await readTextOr(v, `${BANK_TRASH}/${e.id}/Cardiología parcial.md`, '')).toBe(BANK);
    expect(JSON.parse(await readTextOr(v, `${BANK_TRASH}/${e.id}/meta.json`, ''))).toEqual({ id: e.id, deletedAt: 1000, path: P, name: 'Cardio', questions: 1 });
    expect(await listBankTrash(v)).toEqual([e]);
  });

  it('orden: meta y destino antes de quitar el original', async () => {
    const v = await vault();
    const log: string[] = [];
    const raw = v.raw as MemoryBackend;
    const [w, r, m] = [raw.write.bind(raw), raw.remove.bind(raw), raw.move.bind(raw)];
    raw.write = async (p, d) => (log.push('w ' + p), w(p, d));
    raw.remove = async (p) => (log.push('rm ' + p), r(p));
    raw.move = async (a, b) => (log.push(`mv ${a} → ${b}`), m(a, b));
    await trashBank(v, { path: P, name: 'Cardio', questions: 1 }, 1000);
    const iMeta = log.findIndex((x) => x.includes('meta.json') && !x.includes('.tmp'));
    const iDest = log.findIndex((x) => x.endsWith('/Cardiología parcial.md') && x.includes(BANK_TRASH));
    const iRm = log.indexOf('rm ' + P);
    expect(iMeta).toBeGreaterThanOrEqual(0);
    expect(iDest).toBeGreaterThan(iMeta);
    expect(iRm).toBeGreaterThan(iDest);
  });

  it('un fallo a medias no pierde el banco', async () => {
    const v = await vault();
    const raw = v.raw as MemoryBackend;
    raw.remove = async () => { throw new Error('cierre de la app'); };
    await expect(trashBank(v, { path: P, name: 'Cardio', questions: 1 }, 1000)).rejects.toThrow();
    // el original sigue en su sitio o la copia ya está entera en la papelera
    const trashed = await listBankTrash(v);
    expect((await readTextOr(v, P, '')) === BANK || trashed.length === 1).toBe(true);
    // fallo antes del movimiento: el meta sin archivo no se lista y el banco sigue
    const v2 = await vault();
    const raw2 = v2.raw as MemoryBackend;
    const w2 = raw2.write.bind(raw2);
    raw2.write = async (p, d) => { if (p.endsWith('parcial.md') && p.startsWith(BANK_TRASH)) throw new Error('cierre'); return w2(p, d); };
    await expect(trashBank(v2, { path: P, name: 'Cardio', questions: 1 }, 1000)).rejects.toThrow();
    expect(await readTextOr(v2, P, '')).toBe(BANK);
    expect(await listBankTrash(v2)).toEqual([]);
  });

  it('restaura en la misma ruta, idéntico; con choque de nombre, «(restaurado)» sin sobrescribir', async () => {
    const v = await vault();
    const e = await trashBank(v, { path: P, name: 'Cardio', questions: 1 }, 1000);
    expect(await restoreBank(v, e)).toBe(P);
    expect(await readTextOr(v, P, '')).toBe(BANK);
    expect(await listBankTrash(v)).toEqual([]);
    const e2 = await trashBank(v, { path: P, name: 'Cardio', questions: 1 }, 2000);
    await v.write(P, 'otro');
    expect(await restoreBank(v, e2)).toBe('exams-bank/Cardiología parcial (restaurado).md');
    expect(await readTextOr(v, P, '')).toBe('otro');
    const e3 = await trashBank(v, { path: 'exams-bank/Cardiología parcial (restaurado).md', name: 'Cardio', questions: 1 }, 3000);
    await v.write('exams-bank/Cardiología parcial (restaurado).md', 'x');
    const e4 = await trashBank(v, { path: P, name: 'Cardio', questions: 1 }, 4000);
    await v.write(P, 'y');
    expect(await restoreBank(v, e4)).toBe('exams-bank/Cardiología parcial (restaurado 2).md');
    expect(e3.id).not.toBe(e4.id);
  });

  it('banco sin preguntas; eliminar definitivamente; vaciado por días (0 = nunca)', async () => {
    const v = await vault({ 'exams-bank/vacío.md': '' });
    const e = await trashBank(v, { path: 'exams-bank/vacío.md', name: 'vacío', questions: 0 }, 0);
    expect(await listBankTrash(v)).toHaveLength(1);
    expect(await autoPurgeBanks(v, 0, 100 * 86_400_000)).toBe(0);
    expect(await autoPurgeBanks(v, 30, 29 * 86_400_000)).toBe(0);
    expect(await autoPurgeBanks(v, 30, 31 * 86_400_000)).toBe(1);
    expect(await v.exists(`${BANK_TRASH}/${e.id}`)).toBe(false);
    const v2 = await vault();
    const e2 = await trashBank(v2, { path: P, name: 'Cardio', questions: 1 }, 0);
    await purgeBank(v2, e2);
    expect(await listBankTrash(v2)).toEqual([]);
    expect(await v2.exists(P)).toBe(false);
  });
});
