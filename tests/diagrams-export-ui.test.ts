// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

const state = vi.hoisted(() => ({ mode: 'vector' as 'vector' | 'raster', fail: null as string | null, calls: 0 }));
vi.mock('../src/diagrams/export-pdf', () => {
  class PdfExportError extends Error { constructor(readonly code: string) { super(code); } }
  return {
    PdfExportError,
    exportPdf: async () => {
      state.calls++;
      if (state.fail) throw new PdfExportError(state.fail);
      return { blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), mode: state.mode, pages: 3 };
    },
  };
});
vi.mock('../src/diagrams/export', async (orig) => ({
  ...(await orig<typeof import('../src/diagrams/export')>()),
  diagramToPngBlob: async () => null,
}));

import { ExportSheet } from '../src/diagrams/export-ui';
import { parseDiagram } from '../src/diagrams/parse';

const SRC = '(Inicio) --> [Triaje]\n';
const doc = parseDiagram(SRC, 'flujo').doc;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const btn = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
let root: HTMLElement;

beforeEach(() => {
  state.mode = 'vector'; state.fail = null; state.calls = 0;
  URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
  root = document.body.appendChild(document.createElement('div'));
  render(h(ExportSheet, { doc, src: SRC, onClose: () => {}, title: 'Mi mapa' }), root);
});
afterEach(() => { render(null, root); root.remove(); vi.restoreAllMocks(); delete (navigator as any).share; delete (navigator as any).canShare; });

async function openPdf() { await act(() => { btn('PDF')!.click(); }); await flush(); }

describe('hoja de exportar · PDF', () => {
  it('existe el botón PDF y no carga export-pdf antes de elegirlo', async () => {
    expect(btn('PDF')).toBeTruthy();
    await flush();
    expect(state.calls).toBe(0);
  });

  it('al elegir PDF prepara un File .pdf y muestra páginas', async () => {
    await openPdf();
    expect(state.calls).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('3');
    expect(btn('Guardar')!.disabled).toBe(false);
  });

  it('Guardar llama a navigator.share dentro del clic si canShare', async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share, canShare: () => true });
    await openPdf();
    await act(() => { btn('Guardar')!.click(); });
    expect(share).toHaveBeenCalledTimes(1);
    const f = (share.mock.calls[0] as any)[0].files[0] as File;
    expect(f.name).toBe('Mi mapa.pdf');
    expect(f.type).toBe('application/pdf');
  });

  it('sin canShare descarga con <a download>', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openPdf();
    await act(() => { btn('Guardar')!.click(); });
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('modo raster muestra el aviso', async () => {
    state.mode = 'raster';
    await openPdf();
    expect(document.body.textContent).toContain('Se usó imagen');
  });

  it('error paginas con mensaje traducido y Guardar desactivado', async () => {
    state.fail = 'paginas';
    await openPdf();
    expect(document.body.textContent).toContain('demasiadas páginas');
    expect(btn('Guardar')!.disabled).toBe(true);
  });
});
