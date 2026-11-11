import { ChevronDown, ChevronRight, FilePlus2, FolderInput, Import, Share } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { deliver } from '../io/share';
import { type DeckSummary, deckSummaries } from '../lib/summary';
import { go, useApp, useAsync } from '../state';
import { Empty, LargeTitle } from '../ui/kit';
import { readText } from '../vault/util';
import { basename } from '../vault/paths';
import { Layers } from 'lucide-preact';

function Num(props: { n: number; cls: string }) {
  return <td class={props.n ? props.cls : 'zero'}>{props.n}</td>;
}

/** Cuadro de mazos (SPEC §9b G): vidrio con velo denso, jerarquía expandible, filas ≥ 44 px. */
export function DeckTable(props: { decks: DeckSummary[] }) {
  const app = useApp();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const folders = new Map<string, DeckSummary[]>();
  for (const d of props.decks) folders.set(d.folder, [...(folders.get(d.folder) ?? []), d]);
  const toggle = (f: string) => setClosed((s) => (s.has(f) ? (s.delete(f), new Set(s)) : new Set(s.add(f))));

  const row = (d: DeckSummary, indent: boolean) => (
    <tr class="row" key={d.path} onClick={() => go('mazos', ...d.path.split('/'))} style={{ cursor: 'pointer' }}>
      <td>
        <div class="name" style={{ paddingLeft: indent ? '26px' : 0 }}>
          <span class="dot" style={{ background: d.color ? `var(--c-${d.color}, ${d.color})` : undefined }} aria-hidden="true" />
          <a class="t" href={`#/mazos/${d.path.split('/').map(encodeURIComponent).join('/')}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
            {d.name}
          </a>
        </div>
      </td>
      <Num n={d.cards} cls="n-new" />
      <Num n={0} cls="n-learn" />
      <Num n={0} cls="n-due" />
    </tr>
  );

  return (
    <section class="panel glass dense" aria-label="Mazos">
      <div class="panel-title">
        <h2>Mazos</h2>
      </div>
      {props.decks.length === 0 ? (
        <p style={{ padding: '0 20px 12px', color: 'var(--label-2)', margin: 0 }}>Aún no hay mazos. Importa un archivo .md con frontmatter <code>deck:</code>.</p>
      ) : (
        <table class="decks">
          <thead>
            <tr>
              <th scope="col">Mazo</th>
              <th scope="col">Nuevas</th>
              <th scope="col">Aprendiendo</th>
              <th scope="col">Vencidas</th>
            </tr>
          </thead>
          <tbody>
            {[...folders.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([f, ds]) => {
              if (!f) return ds.map((d) => row(d, false));
              const open = !closed.has(f);
              const sum = ds.reduce((n, d) => n + d.cards, 0);
              return [
                <tr class="row" key={'f:' + f} onClick={() => toggle(f)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div class="name">
                      <button type="button" class="btn icon small" style={{ width: '26px', minHeight: '26px', background: 'none' }} aria-expanded={open} aria-label={`${open ? 'Contraer' : 'Expandir'} ${f}`}>
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <span class="t" style={{ fontWeight: 500 }}>{f}</span>
                    </div>
                  </td>
                  <Num n={sum} cls="n-new" />
                  <Num n={0} cls="n-learn" />
                  <Num n={0} cls="n-due" />
                </tr>,
                ...(open ? ds.map((d) => row(d, true)) : []),
              ];
            })}
          </tbody>
        </table>
      )}
      <div class="panel-foot">
        <button type="button" class="btn small" onClick={() => app.openSheet('import')}>
          <FolderInput size={16} aria-hidden="true" /> Obtener compartidos
        </button>
        <button type="button" class="btn small" disabled title="Fase 2">
          <FilePlus2 size={16} aria-hidden="true" /> Crear mazo
        </button>
        <button type="button" class="btn small" onClick={() => app.openSheet('import')}>
          <Import size={16} aria-hidden="true" /> Importar archivo
        </button>
      </div>
    </section>
  );
}

export function Decks() {
  const app = useApp();
  const { data } = useAsync(() => deckSummaries(app.vault), [app.version]);
  return (
    <>
      <LargeTitle title="Mazos" />
      <div class="page">
        {data && data.length === 0 ? (
          <Empty icon={<Layers size={44} aria-hidden="true" />} title="Sin mazos todavía" action={<button type="button" class="btn primary" onClick={() => app.openSheet('import')}>Importar</button>}>
            Un mazo es un archivo .md en la carpeta decks/. Importa uno desde Archivos o carga la bóveda de ejemplo en Ajustes.
          </Empty>
        ) : (
          <DeckTable decks={data ?? []} />
        )}
      </div>
    </>
  );
}

/** Vista de solo lectura del archivo (el editor llega en la fase 2). Superficie opaca: aquí se lee. */
export function DeckView(props: { path: string }) {
  const app = useApp();
  const { data, error } = useAsync(() => readText(app.vault, props.path), [props.path, app.version]);
  const file = data !== undefined ? new File([data], basename(props.path), { type: 'text/markdown' }) : null;
  return (
    <>
      <LargeTitle title={basename(props.path).replace(/\.md$/, '')} sub={props.path}>
        <a class="btn glass" href="#/mazos">Mazos</a>
        <button
          type="button"
          class="btn primary"
          disabled={!file}
          onClick={async () => {
            // `deliver` se invoca en el mismo gesto: el File ya está construido
            const r = await deliver(file!);
            if (r !== 'cancelled') app.toast(r === 'shared' ? 'Archivo compartido' : 'Archivo descargado');
          }}
        >
          <Share size={18} aria-hidden="true" /> Exportar .md
        </button>
      </LargeTitle>
      <div class="page">
        {error ? <p>No se pudo leer el archivo.</p> : <pre class="preview opaque" style={{ maxHeight: 'none', fontSize: '15px' }}>{data ?? 'Cargando…'}</pre>}
      </div>
    </>
  );
}
