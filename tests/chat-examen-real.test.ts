import { describe, expect, it } from 'vitest';
import { applyProposal, buildExam, forgetProposals, isBad, undoProposal, type Proposal } from '../src/chat/proposal';
import { parseBankMarkdown } from '../src/sim/parse';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const CITA = '[PDF: Recopilación 1 Parcial Gine 1.pdf p.5]';
const QS = ['C', 'C', 'D', 'A', 'D'].map((c, i) => ({
  texto: `Paciente de ${20 + i} años con sangrado uterino anormal, ¿cuál es el manejo inicial? ${CITA}`,
  opciones: ['Observar', 'Legrado', 'Anticonceptivos orales', 'Histerectomía', 'Ninguna'],
  correcta: c, explicacion: `Según la guía ${CITA}: «primera línea».`, tema: 'Ginecología: sangrado',
}));
const NAME = 'Simulacro 1 Parcial Ginecología';

describe('crear_examen contra SafeVault real', () => {
  for (const pre of [false, true]) it(`escribe y deshace (exams-bank ${pre ? 'existente' : 'nuevo'})`, async () => {
    forgetProposals();
    const v = new SafeVault(new MemoryBackend());
    if (pre) await v.write('exams-bank/Otro.md', 'x');
    const p = buildExam(NAME, 90, QS);
    expect(isBad(p)).toBe(false);
    const pr = p as Proposal;
    expect(pr.items).toHaveLength(5);
    await applyProposal(v, null, pr, 1);
    const txt = dec(await v.read(pr.destino));
    expect(txt.match(/^origen: ia$/gm)).toHaveLength(1);
    const b = parseBankMarkdown(txt, '');
    expect(b.questions.map((q) => q.answer[0]).join('')).toBe('CCDAD');
    await undoProposal(v, 1);
    expect(dec(await v.read(pr.destino))).toBe('');
    forgetProposals();
    await applyProposal(v, null, pr, 2); // banco vacío = libre
    await expect(applyProposal(v, null, pr, 3)).rejects.toThrow('exists');
  });

  it('un fallo del disco se propaga con su nombre y no deja nada escrito', async () => {
    forgetProposals();
    const m = new MemoryBackend(), v = new SafeVault(m);
    const orig = m.write.bind(m);
    m.write = async (path, d) => { if (path.startsWith('exams-bank/')) throw new DOMException('cuota', 'QuotaExceededError'); return orig(path, d); };
    const pr = buildExam(NAME, 90, QS) as Proposal;
    await expect(applyProposal(v, null, pr, 9)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await v.exists(pr.destino)).toBe(false);
  });
});
