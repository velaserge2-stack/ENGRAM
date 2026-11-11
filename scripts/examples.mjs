// Genera los archivos binarios de examples/ (PDF y DOCX) para pruebas manuales en el iPad.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = new URL('../examples/docs/', import.meta.url).pathname;

// PDF de 12 páginas con texto seleccionable
const pages = Array.from({ length: 12 }, (_, i) => `<section style="page-break-after:always"><h1>Capítulo ${i + 1}: ${['Eje eléctrico', 'Ondas e intervalos', 'Bloqueos AV', 'Isquemia'][i % 4]}</h1>${'<p>La derivación II, III y aVF exploran la cara inferior del corazón. El intervalo PR normal mide entre 120 y 200 ms. '.repeat(6)}</p><p>Página ${i + 1}</p></section>`).join('');
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<html><body style="font-family:Helvetica;padding:30px">${pages}</body></html>`);
writeFileSync(out + 'guia-ecg.pdf', await p.pdf({ format: 'A4' }));
await b.close();

const doc = new Document({ sections: [{ children: [
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Apuntes de neurología')] }),
  new Paragraph({ children: [new TextRun({ text: 'EVC isquémico: ', bold: true }), new TextRun('la ventana de trombólisis es de 4.5 h.')] }),
  new Paragraph({ bullet: { level: 0 }, children: [new TextRun('NIHSS para el déficit')] }),
  new Paragraph({ bullet: { level: 0 }, children: [new TextRun('TAC simple para descartar hemorragia')] }),
  new Table({ rows: [new TableRow({ children: ['Escala', 'Uso'].map((t) => new TableCell({ children: [new Paragraph(t)] })) }), new TableRow({ children: ['NIHSS', 'Déficit'].map((t) => new TableCell({ children: [new Paragraph(t)] })) })] }),
] }] });
writeFileSync(out + 'apuntes-neuro.docx', Buffer.from(await (await Packer.toBlob(doc)).arrayBuffer()));
console.log('ejemplos generados');
