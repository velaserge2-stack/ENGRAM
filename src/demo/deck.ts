// Mazo extra solo-demo (contenido de ejemplo del usuario ficticio): más tarjetas para que Estadísticas y Pronóstico se vean con vida.
const QA: [string, string][] = [
  ['¿Cuál es el antídoto de la heparina?', 'Protamina'],
  ['¿Cuál es el antídoto de la warfarina?', 'Vitamina K (y complejo de protrombina en urgencias)'],
  ['¿Qué fármaco revierte las benzodiacepinas?', 'Flumazenil'],
  ['¿Qué fármaco revierte los opioides?', 'Naloxona'],
  ['¿Antídoto del paracetamol?', 'N-acetilcisteína'],
  ['¿Mecanismo de los IECA?', 'Inhiben la enzima convertidora de angiotensina'],
  ['¿Efecto adverso típico de los IECA?', 'Tos seca (por bradicinina)'],
  ['¿Mecanismo de la furosemida?', 'Bloquea el cotransportador Na-K-2Cl del asa de Henle'],
  ['¿Qué diurético ahorra potasio?', 'Espironolactona (antagonista de aldosterona)'],
  ['¿Mecanismo de los betabloqueadores?', 'Bloquean receptores beta adrenérgicos'],
  ['¿Cuándo se contraindican los betabloqueadores no selectivos?', 'Asma y bloqueo AV de alto grado'],
  ['¿Mecanismo de la aspirina?', 'Inhibe la COX de forma irreversible'],
  ['¿Qué antibiótico causa «síndrome del hombre rojo»?', 'Vancomicina (infusión rápida)'],
  ['¿Mecanismo de las estatinas?', 'Inhiben la HMG-CoA reductasa'],
  ['¿Efecto adverso grave de las estatinas?', 'Miopatía y rabdomiólisis'],
  ['¿Fármaco de primera línea en anafilaxia?', 'Adrenalina intramuscular'],
  ['¿Mecanismo de la metformina?', 'Reduce la gluconeogénesis hepática'],
  ['¿Efecto adverso grave de la metformina?', 'Acidosis láctica'],
  ['¿Qué antiarrítmico se asocia a toxicidad tiroidea y pulmonar?', 'Amiodarona'],
  ['¿Antídoto de la digoxina?', 'Fragmentos Fab antidigoxina'],
  ['¿Mecanismo de los inhibidores de bomba de protones?', 'Inhiben la H+/K+ ATPasa de la célula parietal'],
  ['¿Fármaco de elección en el estatus epiléptico inicial?', 'Una benzodiacepina (lorazepam o diazepam)'],
  ['¿Qué antibiótico puede tender a causar ototoxicidad y nefrotoxicidad?', 'Aminoglucósidos'],
  ['¿Qué ion vigilar con espironolactona y IECA juntos?', 'Potasio (hiperpotasemia)'],
];

export const DEMO_DECK = `---\ndeck: Farmacología\ntags: [farmacologia]\nnew_per_day: 10\n---\n${QA.map(([q, a]) => `Q:: ${q}\nA:: ${a}`).join('\n\n')}\n`;
