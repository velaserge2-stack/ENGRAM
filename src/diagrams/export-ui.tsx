// Hoja «Exportar» del editor de diagramas. Se carga con `import()` al pulsar el botón.
// Preparar → entregar: los `File` (SVG y PNG) se construyen al abrir; el toque solo llama a `navigator.share` (o descarga).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Download, Share2 } from 'lucide-preact';
import { t } from '../i18n';
import { Sheet } from '../ui/kit';
import { diagramToPngBlob, diagramToSvg } from './export';
import { layoutLayered, layoutTree } from './layout';
import type { DiagramDoc } from './types';

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ExportSheet(props: { doc: DiagramDoc; src: string; onClose: () => void }) {
  const { doc } = props;
  const svg = useMemo(() => diagramToSvg(doc, doc.kind === 'mapa' ? layoutTree(doc) : layoutLayered(doc, 'TB')), [doc]);
  const svgFile = useMemo(() => new File([svg], 'diagrama.svg', { type: 'image/svg+xml' }), [svg]);
  const [png, setPng] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    diagramToPngBlob(svg).then((b) => {
      if (!live) return;
      if (b) setPng(new File([b], 'diagrama.png', { type: 'image/png' }));
      else setFailed(true);
    }, () => live && setFailed(true));
    return () => { live = false; };
  }, [svg]);

  const deliver = (file: File | null) => {
    if (!file) return;
    // dentro del gesto, con el File ya construido
    if ('share' in navigator && 'canShare' in navigator && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch((e: Error) => { if (e.name !== 'AbortError') download(file); });
    } else download(file);
  };

  const Btn = (p: { file: File | null; label: string }) => (
    <button type="button" class="btn primary" style={{ minHeight: '44px' }} disabled={!p.file} onClick={() => deliver(p.file)}>
      {'share' in navigator ? <Share2 size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />} {p.label}
    </button>
  );

  return (
    <Sheet title={t('diag.exportar')} onClose={props.onClose}>
      <div class="stack-s">
        <div class="row wrap">
          <Btn file={svgFile} label={t('diag.svg')} />
          {!failed && <Btn file={png} label={t('diag.png')} />}
        </div>
        {failed && (
          <div class="stack-s" role="alert">
            <p>{t('diag.exportar_fallo')}</p>
            <textarea class="input code" readOnly style={{ minHeight: '30dvh', width: '100%' }} value={props.src} aria-label={t('diag.texto_fuente')} data-user-content />
          </div>
        )}
      </div>
    </Sheet>
  );
}
