// Tabla Markdown a partir de docs/rendimiento/baseline.json:  node scripts/perf-table.mjs [json] > tabla.md
import { readFileSync } from 'node:fs';
const J = JSON.parse(readFileSync(process.argv[2] || new URL('../docs/rendimiento/baseline.json', import.meta.url).pathname, 'utf8'));
const f = (x) => (x == null ? '·' : typeof x === 'number' ? String(Math.round(x * 10) / 10) : String(x));
const KEY = { 'nota': 'n/a' };
const rows = [];
for (const [name, bySize] of Object.entries(J.metrics)) {
  const cells = { S: null, M: null, L: null, 'n/a': null, nota: null };
  for (const [sz, e] of Object.entries(bySize)) cells[sz] = name.startsWith('nota-teclear') ? { ...e, p95: [...e.samples.map((x) => x.p95ms)].sort((a, b) => a - b)[e.samples.length >> 1] } : e; // teclear: mediana y p95 por pulsación
  const used = Object.entries(cells).filter(([, e]) => e && e.median != null);
  if (!used.length) continue;
  rows.push(`| ${name} | ${used.map(([s, e]) => `${s}: **${f(e.median)}**`).join('<br>')} | ${used.map(([s, e]) => `${s}: ${f(e.p95)}`).join('<br>')} | ${used.map(([s, e]) => `${s}: ${f(e.journal)}`).join('<br>')} | ${used.map(([s, e]) => `${s}: ${f(e.longTasks)}${e.longestTask ? ` (máx ${Math.round(e.longestTask)})` : ''}`).join('<br>')} | ${used.map(([s, e]) => `${s}: ${f(e.peakMB)}`).join('<br>')} |`);
}
void KEY;
console.log('| Métrica | Mediana (ms) por bóveda | p95 (ms) | Escrituras al diario | Tareas largas >50 ms (máx ms) | Memoria pico (MB, hilo principal) |\n|---|---|---|---|---|---|');
console.log(rows.join('\n'));
