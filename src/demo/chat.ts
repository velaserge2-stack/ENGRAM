// Turno GUIONADO del Asistente en el modo demo: sin red ni modelo. Respuesta corta + propuesta real (buildCards) con Aceptar/Cancelar.
import { t } from '../i18n';
import { add, generation, setStatus } from '../chat/history';
import { buildCards, isBad } from '../chat/proposal';
import type { Collection } from '../data/collection';

const CARDS = [
  { pregunta: '¿Qué derivaciones ven la pared lateral?', respuesta: 'I, aVL, V5 y V6' },
  { pregunta: '¿Cuál es el marcapasos fisiológico del corazón?', respuesta: 'El nodo sinoauricular (60–100 lpm)' },
  { pregunta: '¿Qué intervalo PR define el bloqueo AV de primer grado?', respuesta: 'Mayor de 200 ms' },
];

export async function demoSend(q: string, col: Collection | null | undefined): Promise<void> {
  const gen = generation();
  add('user', q);
  setStatus({ busy: true });
  await new Promise((r) => setTimeout(r, 700));
  if (generation() !== gen) return;
  add('assistant', t('demo.chat_resp'));
  const p = buildCards(col ?? null, 'Cardiología', CARDS);
  if (!isBad(p)) add('proposal', '', { proposal: p, pstate: 'pending' });
  setStatus({ busy: false, alias: 'Gemini' });
}
