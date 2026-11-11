import { Check, FolderOpen, ImagePlus, PlusSquare, Share as ShareIcon } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { verifyDeterminism } from '../data/collection';
import { exampleFiles } from '../lib/example';
import type { Background, Settings } from '../lib/settings';
import { ACCENT_DEFAULT_USES, type AccentUse, srsParams } from '../lib/settings';
import { accentVariant, COLOR_LABEL, COLOR_NAMES, resolveColor } from '../lib/palette';
import { formatBytes, isStandalone, requestPersist, storageInfo } from '../lib/storage';
import { deliver } from '../io/share';
import { State, workloadEstimate } from '../srs/engine';
import { href, useApp, useAsync } from '../state';
import { BUILTINS, BuiltinThumb, importBackground, mediaUrl, SOLIDS } from '../ui/background';
import { Group, PageTitle, Row, Segmented, Switch } from '../ui/kit';
import { FSAccessBackend } from '../vault/fsaccess';
import { rememberFolder } from '../vault/open';
import { walk } from '../vault/util';
import { APP_VERSION } from './backup';

export function InstallSteps() {
  return (
    <ol>
      <li>Toca <b>Compartir</b> <ShareIcon size={16} aria-label="(ícono de compartir)" style={{ verticalAlign: '-3px' }} /> en la barra de Safari.</li>
      <li>Elige <b>Añadir a pantalla de inicio</b> <PlusSquare size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} />.</li>
      <li>Abre Engrama desde su ícono: funciona sin conexión y con pantalla completa.</li>
    </ol>
  );
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; unit?: string; onInput: (v: number) => void }) {
  return (
    <Row k={p.label} sub={`${p.value}${p.unit ?? ''}`}>
      <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={p.value} onInput={(e) => p.onInput(Number((e.target as HTMLInputElement).value))} />
    </Row>
  );
}

const USE_LABEL: Record<AccentUse, string> = {
  nav: 'Elemento activo de la barra superior',
  progreso: 'Anillo y barra de progreso (pomodoro, ritmo del examen)',
  enlaces: 'Enlaces y wikilinks en notas',
  seleccion: 'Selección de texto y cursor',
  calor: 'Mapa de calor',
  boton: 'Botón principal (p. ej. «Bien»)',
  calendario: 'Etiquetas y bloques del calendario',
};

function AccentPicker() {
  const app = useApp();
  const a = app.settings.accent;
  const set = (color: string | null) => app.update({ accent: { color, usos: color ? (a.color ? a.usos : ACCENT_DEFAULT_USES) : a.usos } });
  const hex = a.color ? resolveColor(a.color, false) : '#007AFF';
  const dk = a.color ? accentVariant(resolveColor(a.color, true), 'dark') : null;
  const lt = a.color ? accentVariant(resolveColor(a.color, false), 'light') : null;
  const swatch = (c: string, on: boolean) => ({ width: '36px', height: '36px', borderRadius: '50%', border: 0, background: c, boxShadow: on ? '0 0 0 2px var(--glass-strong), 0 0 0 4px var(--t1)' : 'none' });
  return (
    <>
      <div class="row wrap" style={{ padding: '8px 18px', gap: '10px' }} role="radiogroup" aria-label="Color de acento" data-user-content>
        <button type="button" role="radio" aria-checked={!a.color} aria-label="Sin acento" onClick={() => set(null)} class="btn small" style={{ minHeight: '36px', boxShadow: !a.color ? '0 0 0 2px var(--t1)' : 'none' }}>Sin acento</button>
        {COLOR_NAMES.map((c) => <button type="button" role="radio" aria-checked={a.color === c} aria-label={COLOR_LABEL[c]} title={COLOR_LABEL[c]} onClick={() => set(c)} style={swatch(`var(--c-${c}, ${resolveColor(c, false)})`, a.color === c)} />)}
      </div>
      <Row k="Color libre" sub="Selector o código hex">
        <input type="color" aria-label="Color libre" value={hex} onInput={(e) => set((e.target as HTMLInputElement).value)} data-user-content />
        <input class="input" style={{ width: '110px' }} aria-label="Código hex" value={a.color?.startsWith('#') ? a.color : ''} placeholder="#3A7BD5" onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) set(v.startsWith('#') ? v : `#${v}`); else if (v) app.toast('Usa un código de 6 dígitos, p. ej. #3A7BD5'); }} />
      </Row>
      {a.color && (dk!.adjusted || lt!.adjusted) && (
        <p class="group-f" style={{ borderTop: 0 }}>⚠ Ajustamos el acento para que se lea sobre el vidrio: <span data-user-content style={{ color: dk!.color, background: '#2c2c2e', padding: '0 6px', borderRadius: '6px' }}>{dk!.color}</span> en oscuro y <span data-user-content style={{ color: lt!.color, background: '#ececec', padding: '0 6px', borderRadius: '6px' }}>{lt!.color}</span> en claro.</p>
      )}
      {a.color && (
        <>
          <h3 class="group-h">Dónde usar el acento</h3>
          {(Object.keys(USE_LABEL) as AccentUse[]).map((u) => (
            <Row k={USE_LABEL[u]}>
              <Switch label={USE_LABEL[u]} checked={a.usos.includes(u)} onChange={(v) => app.update({ accent: { color: a.color, usos: v ? [...a.usos, u] : a.usos.filter((x) => x !== u) } })} />
            </Row>
          ))}
        </>
      )}
    </>
  );
}

function Backgrounds() {
  const app = useApp();
  const s = app.settings;
  const [preview, setPreview] = useState<{ prev: Background } | null>(null);
  const { data: images } = useAsync(async () => {
    const files = (await walk(app.vault, 'media/.app/fondos')).filter((f) => f.path.endsWith('-thumb.jpg'));
    return Promise.all(files.map(async (f) => ({ path: f.path.replace('-thumb.jpg', '.jpg'), thumb: await mediaUrl(app.vault, f.path) })));
  }, [app.version]);
  const choose = (bg: Background) => {
    if (!preview) setPreview({ prev: s.bg });
    app.update({ bg });
  };
  const same = (b: Background) => b.kind === s.bg.kind && b.value === s.bg.value;
  return (
    <div class="stack-s" style={{ padding: '10px 18px 14px' }}>
      <div class="bg-grid" role="radiogroup" aria-label="Fondos">
        {BUILTINS.map((b) => (
          <button type="button" role="radio" aria-checked={same({ kind: 'builtin', value: b.id })} aria-pressed={same({ kind: 'builtin', value: b.id })} aria-label={b.name} title={b.name} onClick={() => choose({ kind: 'builtin', value: b.id })}><BuiltinThumb id={b.id} /></button>
        ))}
        {SOLIDS.map((c) => (
          <button type="button" role="radio" aria-checked={same({ kind: 'solid', value: c })} aria-pressed={same({ kind: 'solid', value: c })} aria-label={`Color sólido ${c}`} onClick={() => choose({ kind: 'solid', value: c })} style={{ background: c }} data-user-content />
        ))}
        {images?.map((im) => (
          <button type="button" role="radio" aria-checked={same({ kind: 'image', value: im.path })} aria-pressed={same({ kind: 'image', value: im.path })} aria-label="Imagen propia" onClick={() => choose({ kind: 'image', value: im.path })}>{im.thumb && <img src={im.thumb} alt="" />}</button>
        ))}
        <label class="btn" style={{ aspectRatio: '1', borderRadius: '18px', flexDirection: 'column', height: 'auto' }}>
          <ImagePlus size={22} /><span class="note">Añadir imagen</span>
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (!f) return;
            try {
              const path = await importBackground(app.vault, f);
              app.changed();
              choose({ kind: 'image', value: path });
            } catch {
              app.toast('No se pudo leer la imagen (¿HEIC?). Prueba con JPEG o PNG.');
            }
          }} />
        </label>
      </div>
      <div class="row" style={{ alignItems: 'center' }}>
        <input type="color" aria-label="Color sólido libre" value={s.bg.kind === 'solid' ? s.bg.value : '#1c1c1e'} onInput={(e) => choose({ kind: 'solid', value: (e.target as HTMLInputElement).value })} data-user-content />
        <span class="foot">Color libre</span>
        <span class="grow" />
        {preview && (
          <>
            <button type="button" class="btn small" onClick={() => (app.update({ bg: preview.prev }), setPreview(null))}>Cancelar</button>
            <button type="button" class="btn small primary" onClick={() => (setPreview(null), app.update({}, true))}><Check size={14} /> Aplicar</button>
          </>
        )}
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const app = useApp();
  const s = app.settings;
  const u = (p: Partial<Settings>) => app.update(p);
  const [tick, setTick] = useState(0);
  const { data: info } = useAsync(storageInfo, [tick, app.version]);
  const [det, setDet] = useState<string | null>(null);
  const [paramsText, setParamsText] = useState(s.fsrsW?.join(', ') ?? '');
  const col = app.col;
  const reviews = col?.log.filter((e) => e.rating).length ?? 0;
  const work = col ? workloadEstimate([...col.states.values()].filter((x) => x.card.state !== State.New), [s.retention]) : {};
  const ig = app.integrity;
  const days = s.lastExportAt ? Math.floor((Date.now() - s.lastExportAt) / 86_400_000) : null;
  return (
    <div class="settings">
      <PageTitle title="Ajustes" />

      <Group title="Apariencia · Fondo" footer="El color de Engrama lo pones tú: con el fondo y con los emojis de tus mazos. La interfaz es neutra.">
        <Backgrounds />
        <Slider label="Desenfoque del fondo" min={0} max={40} step={1} unit=" px" value={s.bgBlur} onInput={(v) => u({ bgBlur: v })} />
        <Slider label="Oscurecer / aclarar" min={-50} max={50} step={5} unit=" %" value={s.bgDim} onInput={(v) => u({ bgDim: v })} />
        <Slider label="Intensidad del vidrio" min={0} max={100} step={5} unit=" %" value={s.glass} onInput={(v) => u({ glass: v })} />
        <Row k="Modo del vidrio"><Segmented label="Modo del vidrio" value={s.glassMode} onChange={(v) => u({ glassMode: v })} options={[['auto', 'Auto'], ['dark', 'Oscuro'], ['light', 'Claro']]} /></Row>
        <Row k="Modo ligero" sub="Sin desenfoque: relleno translúcido más opaco. Útil si el vidrio va lento."><Switch label="Modo ligero" checked={s.lightMode} onChange={(v) => u({ lightMode: v })} /></Row>
        <Slider label="Tamaño de texto" min={0.8} max={1.6} step={0.05} value={Math.round(s.textScale * 100) / 100} unit="×" onInput={(v) => u({ textScale: v })} />
        <Row k="Color semántico" sub="Excepción opcional: rojo solo en errores y acciones destructivas."><Switch label="Color semántico" checked={s.semanticColor} onChange={(v) => u({ semanticColor: v })} /></Row>
        <Row k="Guardián de legibilidad" sub={`Ajusta el vidrio para mantener 4.5:1. Paneles revisados: ${(window as unknown as { __guard?: { panels: number; adjusted: number; minContrast: number } }).__guard?.panels ?? '—'}; ajustados: ${(window as unknown as { __guard?: { adjusted: number } }).__guard?.adjusted ?? 0}`}><a class="link" href="#/design">Ver /design</a></Row>
      </Group>

      <Group title="Apariencia · Color de acento" footer="Opcional. Con «Sin acento» la interfaz es neutra. El acento solo aparece donde lo actives.">
        <AccentPicker />
      </Group>

      <Group title="Estudio (FSRS)" footer="Cuatro botones, calibrados para FSRS. La fecha depende de la retención deseada: la tarjeta vuelve cuando su probabilidad de recordarla cae a ese valor.">
        <Slider label="Retención deseada" min={0.8} max={0.97} step={0.01} value={s.retention} onInput={(v) => u({ retention: Math.round(v * 100) / 100 })} />
        <Row k="Carga estimada" sub="Con tu historial actual"><span class="v">≈ {Math.round(work[String(s.retention)] ?? 0)} repasos/día</span></Row>
        <Row k="Nuevas por día" sub="Por defecto; cada mazo puede tener el suyo (new_per_day)"><input class="input" style={{ width: '90px' }} type="number" min={0} value={s.newPerDay} onChange={(e) => u({ newPerDay: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k="Límite de repasos por día"><input class="input" style={{ width: '90px' }} type="number" min={10} value={s.reviewLimit} onChange={(e) => u({ reviewLimit: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k="Pasos de aprendizaje" sub="p. ej. 1m 10m"><input class="input" style={{ width: '130px' }} value={s.learningSteps.join(' ')} onChange={(e) => u({ learningSteps: (e.target as HTMLInputElement).value.split(/\s+/).filter((x) => /^\d+[mhd]$/.test(x)) })} /></Row>
        <Row k="Pasos de reaprendizaje"><input class="input" style={{ width: '130px' }} value={s.relearningSteps.join(' ')} onChange={(e) => u({ relearningSteps: (e.target as HTMLInputElement).value.split(/\s+/).filter((x) => /^\d+[mhd]$/.test(x)) })} /></Row>
        <Row k="Sanguijuela tras" sub="lapsos"><input class="input" style={{ width: '90px' }} type="number" min={3} value={s.leechThreshold} onChange={(e) => u({ leechThreshold: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k="Modo recuperación si hay más de" sub="vencidas; se repasan primero las más olvidadas, con tope diario"><input class="input" style={{ width: '90px' }} type="number" min={20} value={s.recoveryThreshold} onChange={(e) => u({ recoveryThreshold: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k="Sugerir botón por tiempo de respuesta" sub="Solo lo resalta; nunca califica por ti."><Switch label="Sugerir por tiempo" checked={s.suggestByTime} onChange={(v) => u({ suggestByTime: v })} /></Row>
        <Row k="El día empieza a las" sub={`Zona horaria: ${s.timeZone}`}>
          <select aria-label="Hora de inicio del día" value={s.dayStartHour} onChange={(e) => u({ dayStartHour: Number((e.target as HTMLSelectElement).value) })}>
            {Array.from({ length: 24 }, (_, h) => <option value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </Row>
        <Row k="Tarjetas mínimas para la racha"><input class="input" style={{ width: '90px' }} type="number" min={1} value={s.streakMin} onChange={(e) => u({ streakMin: Math.max(1, Number((e.target as HTMLInputElement).value)) })} /></Row>
        <Row k="Idioma de voz por defecto"><input class="input" style={{ width: '110px' }} value={s.ttsLang} onChange={(e) => u({ ttsLang: (e.target as HTMLInputElement).value })} /></Row>
      </Group>

      <Group title="Parámetros FSRS" footer={reviews >= 1000 ? 'Ya tienes historial suficiente para optimizar. Exporta tu historial, optimízalo con una herramienta FSRS y pega aquí los 21 parámetros.' : `Se usan los parámetros por defecto. Con ≥ 1 000 repasos (llevas ${reviews}) conviene optimizarlos con tu historial.`}>
        <Row k="Exportar historial (CSV para optimizador)">
          <button type="button" class="btn small" disabled={!col} onClick={async () => {
            const lines = ['card_id,review_time,review_rating,review_state,review_duration', ...col!.log.filter((e) => e.rating).map((e) => `${e.id},${e.ts},${e.rating},${e.state ?? ''},${e.ms ?? 0}`)];
            await deliver(new File([lines.join('\n')], 'engrama-revlog.csv', { type: 'text/csv' }));
          }}>Exportar</button>
        </Row>
        <Row k="Parámetros personalizados (w)" sub="Vacío = por defecto">
          <input class="input" style={{ width: '220px' }} value={paramsText} placeholder="0.40, 1.18, 3.17…" onInput={(e) => setParamsText((e.target as HTMLInputElement).value)} />
          <button type="button" class="btn small" onClick={() => {
            const w = paramsText.split(/[\s,]+/).filter(Boolean).map(Number);
            if (!paramsText.trim()) return u({ fsrsW: null });
            if (w.length < 17 || w.some((x) => !Number.isFinite(x))) return app.toast('Se esperan 17, 19 o 21 números');
            u({ fsrsW: w });
            app.toast('Parámetros aplicados; el estado se reconstruye con ellos');
          }}>Aplicar</button>
        </Row>
        <Row k="Comprobar determinismo" sub={det ?? 'Reconstruye el estado desde reviews.jsonl y lo compara con state.json'}>
          <button type="button" class="btn small" disabled={!col} onClick={() => { const r = verifyDeterminism(col!, srsParams(s)); setDet(r.ok ? `✓ Idéntico (${col!.states.size} tarjetas)` : `⚠ ${r.mismatched.length} difieren: se reconstruirá`); if (!r.ok) app.changed(); }}>Comprobar</button>
        </Row>
      </Group>

      <Group title="Pomodoro">
        <Row k="Trabajo (min)"><input class="input" style={{ width: '80px' }} type="number" min={1} value={s.pomo.work} onChange={(e) => u({ pomo: { ...s.pomo, work: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k="Descanso (min)"><input class="input" style={{ width: '80px' }} type="number" min={1} value={s.pomo.short} onChange={(e) => u({ pomo: { ...s.pomo, short: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k="Descanso largo (min)"><input class="input" style={{ width: '80px' }} type="number" min={1} value={s.pomo.long} onChange={(e) => u({ pomo: { ...s.pomo, long: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k="Descanso largo cada" sub="ciclos"><input class="input" style={{ width: '80px' }} type="number" min={2} value={s.pomo.every} onChange={(e) => u({ pomo: { ...s.pomo, every: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k="Sonido al terminar" sub="Solo tras tocar Iniciar (Safari exige un gesto)."><Switch label="Sonido" checked={s.pomo.sound} onChange={(v) => u({ pomo: { ...s.pomo, sound: v } })} /></Row>
      </Group>

      <Group title="Notas" footer="Las etiquetas se crean aquí (lista controlada), no al vuelo. El glosario corrige términos en transcripciones.">
        <Row k="Mostrar grafo"><Switch label="Mostrar grafo" checked={s.showGraph} onChange={(v) => u({ showGraph: v })} /></Row>
        <Row k="Mostrar enlaces entrantes"><Switch label="Mostrar enlaces entrantes" checked={s.showBacklinks} onChange={(v) => u({ showBacklinks: v })} /></Row>
        <Row k="Etiquetas" sub={s.tagList.join(', ') || 'Ninguna'}>
          <form class="row" onSubmit={(e) => { e.preventDefault(); const i = (e.currentTarget as HTMLFormElement).elements.namedItem('t') as HTMLInputElement; const t = i.value.trim().replace(/^#/, ''); if (t && !s.tagList.includes(t)) u({ tagList: [...s.tagList, t].sort() }); i.value = ''; }}>
            <input name="t" class="input" style={{ width: '150px' }} placeholder="cardio/ecg" aria-label="Nueva etiqueta" /><button class="btn small" type="submit">Añadir</button>
          </form>
        </Row>
        {s.tagList.length > 0 && <div class="row wrap" style={{ padding: '4px 18px 12px' }}>{s.tagList.map((t) => <button type="button" class="chip" onClick={() => u({ tagList: s.tagList.filter((x) => x !== t) })} aria-label={`Quitar etiqueta ${t}`}>#{t} ✕</button>)}</div>}
        <Row k="Glosario personal" sub="Un término correcto por línea">
          <textarea class="input" style={{ width: '220px' }} rows={3} value={s.glossary.join('\n')} onChange={(e) => u({ glossary: (e.target as HTMLTextAreaElement).value.split('\n').map((x) => x.trim()).filter(Boolean) })} aria-label="Glosario" />
        </Row>
      </Group>

      <Group title="Almacenamiento" footer="Safari guarda tu bóveda en un espacio privado que no se ve en Archivos. Exporta regularmente para tener una copia visible.">
        <Row k="Dónde se guarda" sub={app.detail} />
        <Row k="Almacenamiento persistente" sub={info?.persisted ? 'El sistema no debería borrar tus datos por falta de espacio.' : 'Sin garantía: el sistema podría borrarlos si falta espacio. Instalar la app ayuda.'}>
          <span class="v">{info?.persisted == null ? '—' : info.persisted ? 'Concedido' : 'No concedido'}</span>
          {!info?.persisted && <button type="button" class="link" onClick={async () => (await requestPersist(), setTick((n) => n + 1))}>Pedir</button>}
        </Row>
        <Row k="Espacio usado"><span class="v">{formatBytes(info?.usage ?? null)} de {formatBytes(info?.quota ?? null)}</span></Row>
        {FSAccessBackend.isSupported() && (
          <Row k="Usar una carpeta de este equipo" sub="Solo en navegadores de escritorio con acceso a carpetas.">
            <button type="button" class="btn small" onClick={async () => { try { const b = await FSAccessBackend.pick(); await rememberFolder(b.root); location.reload(); } catch { /* cancelado */ } }}><FolderOpen size={16} /> Elegir</button>
          </Row>
        )}
        {app.vault.kind === 'fsaccess' && <Row k="Volver al almacenamiento privado"><button type="button" class="link" onClick={async () => (await rememberFolder(null), location.reload())}>Desconectar carpeta</button></Row>}
      </Group>

      <Group title="Respaldo">
        <Row k="Último respaldo" sub={days === null ? 'Nunca' : days === 0 ? 'Hoy' : `Hace ${days} días`}><button type="button" class="btn small primary" onClick={() => app.openSheet('backup')}>Respaldar ahora</button></Row>
        <Row k="Recordatorio semanal" sub="Aviso discreto en Hoy; nunca notificaciones."><Switch label="Recordatorio semanal" checked={s.weeklyBackupReminder} onChange={(v) => u({ weeklyBackupReminder: v })} /></Row>
        <Row k="Avisar si pasan más de">
          <select aria-label="Días sin respaldo" value={s.backupReminderDays} onChange={(e) => u({ backupReminderDays: Number((e.target as HTMLSelectElement).value) })}>{[3, 7, 14, 30].map((d) => <option value={d}>{d} días</option>)}</select>
        </Row>
        <Row k="Importar archivos o restaurar"><button type="button" class="link" onClick={() => app.openSheet('import')}>Importar…</button></Row>
      </Group>

      <Group title="Integridad" footer="Se comprueba al abrir. Engrama nunca borra ni corrige archivos por su cuenta.">
        <Row k="Archivos" sub={ig ? Object.entries(ig.byFolder).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'Bóveda vacía' : 'Comprobando…'}><span class="v">{ig?.files ?? '—'}</span></Row>
        {ig?.problems.map((p) => <Row k={<code style={{ wordBreak: 'break-all' }}>{p.path}</code>} sub={`⚠ ${p.reason}`} />)}
        <Row k={ig?.problems.length ? `${ig.problems.length} problemas` : '✓ Sin problemas'}><button type="button" class="link" onClick={() => void app.recheckIntegrity()}>Comprobar de nuevo</button></Row>
      </Group>

      <Group title="Instalar">
        {isStandalone() ? <Row k="✓ Engrama está instalada" sub="Abierta desde la pantalla de inicio." /> : <div class="row-i"><div class="k"><InstallSteps /></div></div>}
      </Group>

      <Group title="Más">
        <Row k="Add-ons" onClick={() => (location.hash = '#/addons')}><span class="v">›</span></Row>
        <Row k="Página de diseño" sub="Componentes sobre 5 fondos de prueba" onClick={() => (location.hash = href('design'))}><span class="v">›</span></Row>
        <Row k="Cargar bóveda de ejemplo" sub="Añade mazos y notas de muestra sin tocar los tuyos.">
          <button type="button" class="link" onClick={async () => {
            let n = 0;
            for (const f of await exampleFiles()) if (!(await app.vault.exists(f.path))) (await app.vault.write(f.path, f.text), n++);
            app.changed();
            app.toast(n ? `${n} archivos de ejemplo añadidos` : 'Los ejemplos ya estaban');
          }}>Cargar</button>
        </Row>
      </Group>
      <Group title="Acerca de">
        <div class="row" style={{ padding: '14px 18px', gap: '16px' }}>
          <img class="brand-logo" src="brand/logo-256.png" width="72" height="72" alt="Logo de Engrama" style={{ borderRadius: '18px' }} />
          <div><div style={{ fontWeight: 500, fontSize: 'var(--t-3)' }}>Engrama</div><div class="foot">Versión {APP_VERSION} · sin servidores, sin cuentas, sin analítica</div></div>
        </div>
      </Group>
      <div style={{ height: '24px' }} />
    </div>
  );
}
