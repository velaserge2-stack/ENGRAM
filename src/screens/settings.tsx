import { t as tr, deviceLang, firstDayOfWeek, LANGS, setLang } from '../i18n';
import { Check, Crop, FolderOpen, ImagePlus, PlusSquare, Share as ShareIcon, Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_FRAMING, framingStyle, FRAMING_PATH, normFraming, parseFramings, type Framing } from '../lib/framing';
import { AddonsGroup } from './addons';
import { verifyDeterminism } from '../data/collection';
import { exampleFiles } from '../lib/example';
import type { Background, Settings } from '../lib/settings';
import { ACCENT_DEFAULT_USES, type AccentUse, srsParams } from '../lib/settings';
import { accentVariant, COLOR_LABEL, COLOR_NAMES, resolveColor } from '../lib/palette';
import { formatBytes, isStandalone, requestPersist, storageInfo } from '../lib/storage';
import { deliver } from '../io/share';
import { State, workloadEstimate } from '../srs/engine';
import { href, useApp, useAsync } from '../state';
import { BUILTINS, BuiltinThumb, deleteBackground, importBackground, mediaUrl, regenThumb, SOLIDS } from '../ui/background';
import { Group, PageTitle, Row, Segmented, Sheet, Switch } from '../ui/kit';
import { FSAccessBackend } from '../vault/fsaccess';
import { rememberFolder } from '../vault/open';
import { readTextOr, walk } from '../vault/util';
import { APP_VERSION } from './backup';

export function InstallSteps() {
  return (
    <ol>
      <li>{tr('settings.toca')}{' '}<b>{tr('settings.compartir')}</b> <ShareIcon size={16} aria-label={tr('settings.icono_de_compartir')} style={{ verticalAlign: '-3px' }} />{' '}{tr('settings.en_la_barra_de_safari')}</li>
      <li>{tr('settings.elige')}{' '}<b>{tr('settings.anadir_a_pantalla_de_inicio')}</b> <PlusSquare size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} />.</li>
      <li>{tr('settings.abre_engrama_desde_su_icono_funciona')}</li>
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

const USE_LABEL = (): Record<AccentUse, string> => ({
  nav: tr('settings.elemento_activo_de_la_barra_superior'),
  progreso: tr('settings.anillo_y_barra_de_progreso_pomodoro'),
  enlaces: tr('settings.enlaces_y_wikilinks_en_notas'),
  seleccion: tr('settings.seleccion_de_texto_y_cursor'),
  calor: tr('settings.mapa_de_calor'),
  boton: tr('settings.boton_principal_p_ej_bien'),
  calendario: tr('settings.etiquetas_y_bloques_del_calendario'),
});

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
      <div class="row wrap" style={{ padding: '8px 18px', gap: '10px' }} role="radiogroup" aria-label={tr('settings.color_de_acento')} data-user-content>
        <button type="button" role="radio" aria-checked={!a.color} aria-label={tr('settings.sin_acento')} onClick={() => set(null)} class="btn small" style={{ minHeight: '36px', boxShadow: !a.color ? '0 0 0 2px var(--t1)' : 'none' }}>{tr('settings.sin_acento')}</button>
        {COLOR_NAMES.map((c) => <button type="button" role="radio" aria-checked={a.color === c} aria-label={COLOR_LABEL[c]} onClick={() => set(c)} style={swatch(`var(--c-${c}, ${resolveColor(c, false)})`, a.color === c)} />)}
      </div>
      <Row k={tr('settings.color_libre')} sub={tr('settings.selector_o_codigo_hex')}>
        <input type="color" aria-label={tr('settings.color_libre')} value={hex} onInput={(e) => set((e.target as HTMLInputElement).value)} data-user-content />
        <input class="input" style={{ width: '110px' }} aria-label={tr('settings.codigo_hex')} value={a.color?.startsWith('#') ? a.color : ''} placeholder="#3A7BD5" onChange={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) set(v.startsWith('#') ? v : `#${v}`); else if (v) app.toast(tr('settings.usa_hex')); }} />
      </Row>
      {a.color && (dk!.adjusted || lt!.adjusted) && (
        <p class="group-f" style={{ borderTop: 0 }}>{tr('settings.ajustamos_el_acento_para_que_se')}{' '}<span data-user-content style={{ color: dk!.color, background: '#2c2c2e', padding: '0 6px', borderRadius: '6px' }}>{dk!.color}</span>{' '}{tr('settings.en_oscuro_y')}{' '}<span data-user-content style={{ color: lt!.color, background: '#ececec', padding: '0 6px', borderRadius: '6px' }}>{lt!.color}</span>{' '}{tr('settings.en_claro')}</p>
      )}
      {a.color && (
        <>
          <h3 class="group-h">{tr('settings.donde_usar_el_acento')}</h3>
          {(Object.keys(USE_LABEL()) as AccentUse[]).map((u) => (
            <Row k={USE_LABEL()[u]}>
              <Switch label={USE_LABEL()[u]} checked={a.usos.includes(u)} onChange={(v) => app.update({ accent: { color: a.color, usos: v ? [...a.usos, u] : a.usos.filter((x) => x !== u) } })} />
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
  const [manage, setManage] = useState<Set<string> | null>(null);
  const [framing, setFraming] = useState<string | null>(null);
  const togglePick = (p: string) => setManage((m) => { const n = new Set(m); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const removeSelected = async () => {
    const paths = [...(manage ?? [])];
    if (!paths.length || !confirm(tr('settings.eliminar_fondos_confirm', { n: paths.length }))) return;
    const fr = parseFramings(await readTextOr(app.vault, FRAMING_PATH, '{}'));
    for (const p of paths) (await deleteBackground(app.vault, p), delete fr[p]);
    await app.vault.write(FRAMING_PATH, JSON.stringify(fr, null, 1));
    // si el fondo en uso se borró, vuelve al integrado por defecto
    if (s.bg.kind === 'image' && paths.includes(s.bg.value)) app.update({ bg: { kind: 'builtin', value: 'bruma' } }, true);
    setManage(null);
    app.changed();
    app.toast(tr('settings.fondos_eliminados', { n: paths.length }));
  };
  return (
    <div class="stack-s" style={{ padding: '10px 18px 14px' }}>
      {!!images?.length && (
        <div class="row wrap">
          <span class="foot grow">{manage ? tr('settings.toca_para_seleccionar') : tr('settings.tus_fondos_n', { n: images.length })}</span>
          {manage ? (
            <>
              <button type="button" class="btn small" disabled={manage.size !== 1} onClick={() => setFraming([...manage][0]!)}><Crop size={14} />{' '}{tr('settings.encuadrar')}</button>
              <button type="button" class="btn small danger" disabled={!manage.size} onClick={() => void removeSelected()}><Trash2 size={14} />{' '}{tr('settings.eliminar_n', { n: manage.size })}</button>
              <button type="button" class="btn small" onClick={() => setManage(null)}>{tr('settings.listo')}</button>
            </>
          ) : <button type="button" class="btn small" onClick={() => setManage(new Set())}>{tr('settings.gestionar_fondos')}</button>}
        </div>
      )}
      {framing && <FramingEditor path={framing} onClose={() => (setFraming(null), setManage(null))} />}
      <div class="bg-grid" role="radiogroup" aria-label={tr('settings.fondos')}>
        {BUILTINS.map((b) => (
          <button type="button" role="radio" aria-checked={same({ kind: 'builtin', value: b.id })} aria-pressed={same({ kind: 'builtin', value: b.id })} aria-label={tr(`bg.${b.id}`)} onClick={() => choose({ kind: 'builtin', value: b.id })}><BuiltinThumb id={b.id} /></button>
        ))}
        {SOLIDS.map((c) => (
          <button type="button" role="radio" aria-checked={same({ kind: 'solid', value: c })} aria-pressed={same({ kind: 'solid', value: c })} aria-label={tr('settings.color_solido_c', { c: c })} onClick={() => choose({ kind: 'solid', value: c })} style={{ background: c }} data-user-content />
        ))}
        {images?.map((im) => (
          manage
            ? <button type="button" role="checkbox" class="bg-pick" aria-checked={manage.has(im.path)} aria-label={tr('settings.imagen_propia')} onClick={() => togglePick(im.path)}>{im.thumb && <img src={im.thumb} alt="" />}<span class="bg-check" aria-hidden="true">{manage.has(im.path) ? '✓' : ''}</span></button>
            : <button type="button" role="radio" aria-checked={same({ kind: 'image', value: im.path })} aria-pressed={same({ kind: 'image', value: im.path })} aria-label={tr('settings.imagen_propia')} onClick={() => choose({ kind: 'image', value: im.path })}>{im.thumb && <img src={im.thumb} alt="" />}</button>
        ))}
        <label class="btn" style={{ aspectRatio: '1', borderRadius: '18px', flexDirection: 'column', height: 'auto' }}>
          <ImagePlus size={22} /><span class="note">{tr('settings.anadir_imagen')}</span>
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (!f) return;
            try {
              const path = await importBackground(app.vault, f);
              app.changed();
              choose({ kind: 'image', value: path });
            } catch {
              app.toast(tr('settings.no_se_pudo_leer_imagen'));
            }
          }} />
        </label>
      </div>
      <div class="row" style={{ alignItems: 'center' }}>
        <input type="color" aria-label={tr('settings.color_solido_libre')} value={s.bg.kind === 'solid' ? s.bg.value : '#1c1c1e'} onInput={(e) => choose({ kind: 'solid', value: (e.target as HTMLInputElement).value })} data-user-content />
        <span class="foot">{tr('settings.color_libre')}</span>
        <span class="grow" />
        {preview && (
          <>
            <button type="button" class="btn small" onClick={() => (app.update({ bg: preview.prev }), setPreview(null))}>{tr('settings.cancelar')}</button>
            <button type="button" class="btn small primary" onClick={() => (setPreview(null), app.update({}, true))}><Check size={14} />{' '}{tr('settings.aplicar')}</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Editor de encuadre (C9): arrastrar para mover, pellizcar o deslizador para acercar,
 * con paneles de muestra encima. Guarda en .app/fondos.json y regenera la miniatura.
 */
function FramingEditor(props: { path: string; onClose: () => void }) {
  const app = useApp();
  const [f, setF] = useState<Framing>(DEFAULT_FRAMING);
  const { data: url } = useAsync(async () => {
    setF(normFraming(parseFramings(await readTextOr(app.vault, FRAMING_PATH, '{}'))[props.path]));
    return mediaUrl(app.vault, props.path);
  }, [props.path]);
  const box = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ f: Framing; d: number; x: number; y: number } | null>(null);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const ratio = innerWidth / innerHeight;
  const save = async () => {
    const all = parseFramings(await readTextOr(app.vault, FRAMING_PATH, '{}'));
    all[props.path] = normFraming(f);
    await app.vault.write(FRAMING_PATH, JSON.stringify(all, null, 1));
    await regenThumb(app.vault, props.path, f);
    app.changed();
    props.onClose();
  };
  const dist = () => { const [a, b] = [...pts.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  return (
    <Sheet title={tr('settings.encuadrar_fondo')} onClose={props.onClose} wide>
      <div class="stack">
        <div ref={box} class="frame-box" style={{ aspectRatio: `${ratio}` }} role="img" aria-label={tr('settings.vista_previa_encuadre')}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); start.current = { f, d: dist(), x: e.clientX, y: e.clientY }; }}
          onPointerMove={(e) => {
            if (!pts.current.has(e.pointerId) || !start.current || !box.current) return;
            pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const s0 = start.current;
            if (pts.current.size >= 2 && s0.d) return setF({ ...s0.f, zoom: clamp(s0.f.zoom * (dist() / s0.d), 1, 3) });
            const r = box.current.getBoundingClientRect();
            // arrastrar a la derecha muestra más del lado izquierdo de la foto
            setF({ ...s0.f, x: clamp(s0.f.x - ((e.clientX - s0.x) / r.width) * 100 / s0.f.zoom, 0, 100), y: clamp(s0.f.y - ((e.clientY - s0.y) / r.height) * 100 / s0.f.zoom, 0, 100) });
          }}
          onPointerUp={(e) => { pts.current.delete(e.pointerId); start.current = pts.current.size ? { f, d: dist(), x: [...pts.current.values()][0]!.x, y: [...pts.current.values()][0]!.y } : null; }}
          onPointerCancel={(e) => pts.current.delete(e.pointerId)}>
          {url && <img src={url} alt="" draggable={false} style={framingStyle(f)} />}
          <div class="frame-mock" aria-hidden="true"><i class="glass" /><i class="glass" /><i class="glass" /></div>
        </div>
        <Row k={tr('settings.acercar')} sub={`${f.zoom.toFixed(2)}×`}>
          <input type="range" min={1} max={3} step={0.01} value={f.zoom} aria-label={tr('settings.acercar')} onInput={(e) => setF({ ...f, zoom: Number((e.target as HTMLInputElement).value) })} />
        </Row>
        <p class="foot">{tr('settings.encuadre_nota')}</p>
        <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
          <button type="button" class="btn" onClick={() => setF(DEFAULT_FRAMING)}>{tr('settings.restablecer')}</button>
          <button type="button" class="btn primary" onClick={() => void save()}><Check size={16} />{' '}{tr('profile.guardar')}</button>
        </div>
      </div>
    </Sheet>
  );
}

export function SettingsScreen(props: { focus?: string | null } = {}) {
  const app = useApp();
  // #/ajustes/<sección>: desplaza hasta ella (p. ej. Add-ons)
  useEffect(() => { if (props.focus) document.getElementById(props.focus)?.scrollIntoView({ block: 'start' }); }, [props.focus]);
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
      <PageTitle title={tr('app.ajustes')} />

      <Group>
        <Row k={tr('profile.perfil')} sub={tr('profile.ajustes_sub')} onClick={() => (location.hash = href('perfil'))}><span class="v">›</span></Row>
      </Group>

      <Group title={tr('settings.idioma')} footer={tr('settings.idioma_nota')}>
        <div class="row-i">
          <Segmented label={tr('settings.idioma')} value={s.lang === 'xx' ? '' : s.lang} onChange={(v) => { setLang(v || deviceLang()); app.update({ lang: v, weekStartsMonday: firstDayOfWeek() === 1 }, true); }}
            options={[['', tr('settings.idioma_auto', { lang: LANGS.find((x) => x.id === deviceLang())!.name })], ...LANGS.map((x) => [x.id, x.name] as [typeof x.id, string])]} />
        </div>
      </Group>

      <Group title={tr('settings.apariencia_fondo')} footer={tr('settings.el_color_de_engrama_lo_pones')}>
        <Backgrounds />
        <Slider label={tr('settings.desenfoque_del_fondo')} min={0} max={40} step={1} unit=" px" value={s.bgBlur} onInput={(v) => u({ bgBlur: v })} />
        <Slider label={tr('settings.oscurecer_aclarar')} min={-50} max={50} step={5} unit=" %" value={s.bgDim} onInput={(v) => u({ bgDim: v })} />
        <Slider label={tr('settings.intensidad_del_vidrio')} min={0} max={100} step={5} unit=" %" value={s.glass} onInput={(v) => u({ glass: v })} />
        <Row k={tr('settings.modo_del_vidrio')}><Segmented label={tr('settings.modo_del_vidrio')} value={s.glassMode} onChange={(v) => u({ glassMode: v })} options={[['auto', tr('settings.auto')], ['dark', tr('design.oscuro')], ['light', tr('design.claro')]]} /></Row>
        <Row k={tr('settings.modo_ligero')} sub={tr('settings.sin_desenfoque_relleno_translucido_mas_opa')}><Switch label={tr('settings.modo_ligero')} checked={s.lightMode} onChange={(v) => u({ lightMode: v })} /></Row>
        <Slider label={tr('settings.tamano_de_texto')} min={0.8} max={1.6} step={0.05} value={Math.round(s.textScale * 100) / 100} unit="×" onInput={(v) => u({ textScale: v })} />
        <Row k={tr('settings.color_semantico')} sub={tr('settings.excepcion_opcional_rojo_solo_en_errores')}><Switch label={tr('settings.color_semantico')} checked={s.semanticColor} onChange={(v) => u({ semanticColor: v })} /></Row>
        <Row k={tr('settings.guardian_de_legibilidad')} sub={tr('settings.ajusta_el_vidrio_para_mantener_4', { p: (window as unknown as { __guard?: { panels: number; adjusted: number; minContrast: number } }).__guard?.panels ?? '—', p2: (window as unknown as { __guard?: { adjusted: number } }).__guard?.adjusted ?? 0 })}><a class="link" href="#/design">{tr('settings.ver_design')}</a></Row>
      </Group>

      <Group title={tr('settings.apariencia_color_de_acento')} footer={tr('settings.opcional_con_sin_acento_la_interfaz')}>
        <AccentPicker />
      </Group>

      <Group title={tr('settings.estudio_fsrs')} footer={tr('settings.cuatro_botones_calibrados_para_fsrs_la')}>
        <Slider label={tr('settings.retencion_deseada')} min={0.8} max={0.97} step={0.01} value={s.retention} onInput={(v) => u({ retention: Math.round(v * 100) / 100 })} />
        <Row k={tr('settings.carga_estimada')} sub={tr('settings.con_tu_historial_actual')}><span class="v">≈ {Math.round(work[String(s.retention)] ?? 0)}{' '}{tr('settings.repasos_dia')}</span></Row>
        <Row k={tr('decks.nuevas_por_dia')} sub={tr('settings.por_defecto_cada_mazo_puede_tener')}><input class="input" style={{ width: '90px' }} type="number" min={0} value={s.newPerDay} onChange={(e) => u({ newPerDay: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k={tr('settings.limite_de_repasos_por_dia')}><input class="input" style={{ width: '90px' }} type="number" min={10} value={s.reviewLimit} onChange={(e) => u({ reviewLimit: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k={tr('settings.pasos_de_aprendizaje')} sub={tr('settings.p_ej_1m_10m')}><input class="input" style={{ width: '130px' }} value={s.learningSteps.join(' ')} onChange={(e) => u({ learningSteps: (e.target as HTMLInputElement).value.split(/\s+/).filter((x) => /^\d+[mhd]$/.test(x)) })} /></Row>
        <Row k={tr('settings.pasos_de_reaprendizaje')}><input class="input" style={{ width: '130px' }} value={s.relearningSteps.join(' ')} onChange={(e) => u({ relearningSteps: (e.target as HTMLInputElement).value.split(/\s+/).filter((x) => /^\d+[mhd]$/.test(x)) })} /></Row>
        <Row k={tr('settings.sanguijuela_tras')} sub={tr('settings.lapsos')}><input class="input" style={{ width: '90px' }} type="number" min={3} value={s.leechThreshold} onChange={(e) => u({ leechThreshold: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k={tr('settings.modo_recuperacion_si_hay_mas_de')} sub={tr('settings.vencidas_se_repasan_primero_las_mas')}><input class="input" style={{ width: '90px' }} type="number" min={20} value={s.recoveryThreshold} onChange={(e) => u({ recoveryThreshold: Number((e.target as HTMLInputElement).value) })} /></Row>
        <Row k={tr('settings.sugerir_boton_por_tiempo_de_respuesta')} sub={tr('settings.solo_lo_resalta_nunca_califica_por')}><Switch label={tr('settings.sugerir_por_tiempo')} checked={s.suggestByTime} onChange={(v) => u({ suggestByTime: v })} /></Row>
        <Row k={tr('settings.el_dia_empieza_a_las')} sub={tr('settings.zona_horaria_timezone', { timeZone: s.timeZone })}>
          <select aria-label={tr('settings.hora_de_inicio_del_dia')} value={s.dayStartHour} onChange={(e) => u({ dayStartHour: Number((e.target as HTMLSelectElement).value) })}>
            {Array.from({ length: 24 }, (_, h) => <option value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </Row>
        <Row k={tr('settings.tarjetas_minimas_para_la_racha')}><input class="input" style={{ width: '90px' }} type="number" min={1} value={s.streakMin} onChange={(e) => u({ streakMin: Math.max(1, Number((e.target as HTMLInputElement).value)) })} /></Row>
        <Row k={tr('settings.idioma_de_voz_por_defecto')}><input class="input" style={{ width: '110px' }} value={s.ttsLang} onChange={(e) => u({ ttsLang: (e.target as HTMLInputElement).value })} /></Row>
      </Group>

      <Group title={tr('settings.parametros_fsrs')} footer={reviews >= 1000 ? tr('settings.ya_tienes_historial_suficiente_para_optimi') : tr('settings.se_usan_los_parametros_por_defecto', { reviews: reviews })}>
        <Row k={tr('settings.exportar_historial_csv_para_optimizador')}>
          <button type="button" class="btn small" disabled={!col} onClick={async () => {
            const lines = ['card_id,review_time,review_rating,review_state,review_duration', ...col!.log.filter((e) => e.rating).map((e) => `${e.id},${e.ts},${e.rating},${e.state ?? ''},${e.ms ?? 0}`)];
            await deliver(new File([lines.join('\n')], 'engrama-revlog.csv', { type: 'text/csv' }));
          }}>{tr('deck.exportar')}</button>
        </Row>
        <Row k={tr('settings.parametros_personalizados_w')} sub={tr('settings.vacio_por_defecto')}>
          <input class="input" style={{ width: '220px' }} value={paramsText} placeholder="0.40, 1.18, 3.17…" onInput={(e) => setParamsText((e.target as HTMLInputElement).value)} />
          <button type="button" class="btn small" onClick={() => {
            const w = paramsText.split(/[\s,]+/).filter(Boolean).map(Number);
            if (!paramsText.trim()) return u({ fsrsW: null });
            if (w.length < 17 || w.some((x) => !Number.isFinite(x))) return app.toast(tr('settings.se_esperan_numeros'));
            u({ fsrsW: w });
            app.toast(tr('settings.parametros_aplicados'));
          }}>{tr('settings.aplicar')}</button>
        </Row>
        <Row k={tr('settings.comprobar_determinismo')} sub={det ?? tr('settings.reconstruye_estado')}>
          <button type="button" class="btn small" disabled={!col} onClick={() => { const r = verifyDeterminism(col!, srsParams(s)); setDet(r.ok ? tr('settings.identico', { n: col!.states.size }) : tr('settings.difieren', { n: r.mismatched.length })); if (!r.ok) app.changed(); }}>{tr('cardview.comprobar')}</button>
        </Row>
      </Group>

      <Group title={tr('today.pomodoro')}>
        <Row k={tr('settings.trabajo_min')}><input class="input" style={{ width: '80px' }} type="number" min={1} value={s.pomo.work} onChange={(e) => u({ pomo: { ...s.pomo, work: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k={tr('settings.descanso_min')}><input class="input" style={{ width: '80px' }} type="number" min={1} value={s.pomo.short} onChange={(e) => u({ pomo: { ...s.pomo, short: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k={tr('settings.descanso_largo_min')}><input class="input" style={{ width: '80px' }} type="number" min={1} value={s.pomo.long} onChange={(e) => u({ pomo: { ...s.pomo, long: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k={tr('settings.descanso_largo_cada')} sub={tr('settings.ciclos')}><input class="input" style={{ width: '80px' }} type="number" min={2} value={s.pomo.every} onChange={(e) => u({ pomo: { ...s.pomo, every: Number((e.target as HTMLInputElement).value) } })} /></Row>
        <Row k={tr('settings.sonido_al_terminar')} sub={tr('settings.solo_tras_tocar_iniciar_safari_exige')}><Switch label={tr('settings.sonido')} checked={s.pomo.sound} onChange={(v) => u({ pomo: { ...s.pomo, sound: v } })} /></Row>
      </Group>

      <Group title={tr('notes.notas')} footer={tr('settings.las_etiquetas_se_crean_aqui_lista')}>
        <Row k={tr('settings.mostrar_grafo')}><Switch label={tr('settings.mostrar_grafo')} checked={s.showGraph} onChange={(v) => u({ showGraph: v })} /></Row>
        <Row k={tr('settings.mostrar_enlaces_entrantes')}><Switch label={tr('settings.mostrar_enlaces_entrantes')} checked={s.showBacklinks} onChange={(v) => u({ showBacklinks: v })} /></Row>
        <Row k={tr('deck.etiquetas')} sub={s.tagList.join(', ') || tr('settings.ninguna')}>
          <form class="row" onSubmit={(e) => { e.preventDefault(); const i = (e.currentTarget as HTMLFormElement).elements.namedItem('t') as HTMLInputElement; const t = i.value.trim().replace(/^#/, ''); if (t && !s.tagList.includes(t)) u({ tagList: [...s.tagList, t].sort() }); i.value = ''; }}>
            <input name="t" class="input" style={{ width: '150px' }} placeholder="cardio/ecg" aria-label={tr('settings.nueva_etiqueta')} /><button class="btn small" type="submit">{tr('notes.anadir_2')}</button>
          </form>
        </Row>
        {s.tagList.length > 0 && <div class="row wrap" style={{ padding: '4px 18px 12px' }}>{s.tagList.map((t) => <button type="button" class="chip" onClick={() => u({ tagList: s.tagList.filter((x) => x !== t) })} aria-label={tr('settings.quitar_etiqueta_t', { t: t })}>#{t} ✕</button>)}</div>}
        <Row k={tr('settings.glosario_personal')} sub={tr('settings.un_termino_correcto_por_linea')}>
          <textarea class="input" style={{ width: '220px' }} rows={3} value={s.glossary.join('\n')} onChange={(e) => u({ glossary: (e.target as HTMLTextAreaElement).value.split('\n').map((x) => x.trim()).filter(Boolean) })} aria-label={tr('settings.glosario')} />
        </Row>
      </Group>

      <Group title={tr('settings.almacenamiento')} footer={tr('backup.safari_guarda_tu_boveda_en_un')}>
        <Row k={tr('settings.donde_se_guarda')} sub={app.detail} />
        <Row k={tr('settings.almacenamiento_persistente')} sub={info?.persisted ? tr('settings.el_sistema_no_deberia_borrar_tus') : tr('settings.sin_garantia_el_sistema_podria_borrarlos')}>
          <span class="v">{info?.persisted == null ? '—' : info.persisted ? tr('settings.concedido') : tr('settings.no_concedido')}</span>
          {!info?.persisted && <button type="button" class="link" onClick={async () => (await requestPersist(), setTick((n) => n + 1))}>{tr('settings.pedir')}</button>}
        </Row>
        <Row k={tr('settings.espacio_usado')}><span class="v">{tr('settings.usado_de', { used: formatBytes(info?.usage ?? null), quota: formatBytes(info?.quota ?? null) })}</span></Row>
        {FSAccessBackend.isSupported() && (
          <Row k={tr('settings.usar_una_carpeta_de_este_equipo')} sub={tr('settings.solo_en_navegadores_de_escritorio_con')}>
            <button type="button" class="btn small" onClick={async () => { try { const b = await FSAccessBackend.pick(); await rememberFolder(b.root); location.reload(); } catch { /* cancelado */ } }}><FolderOpen size={16} />{' '}{tr('settings.elegir')}</button>
          </Row>
        )}
        {app.vault.kind === 'fsaccess' && <Row k={tr('settings.volver_al_almacenamiento_privado')}><button type="button" class="link" onClick={async () => (await rememberFolder(null), location.reload())}>{tr('settings.desconectar_carpeta')}</button></Row>}
      </Group>

      <Group title={tr('app.respaldo')}>
        <Row k={tr('settings.ultimo_respaldo')} sub={days === null ? tr('settings.nunca') : days === 0 ? tr('today.hoy') : tr('settings.hace_days_dias', { days: days })}><button type="button" class="btn small primary" onClick={() => app.openSheet('backup')}>{tr('settings.respaldar_ahora')}</button></Row>
        <Row k={tr('settings.recordatorio_semanal')} sub={tr('settings.aviso_discreto_en_hoy_nunca_notificaciones')}><Switch label={tr('settings.recordatorio_semanal')} checked={s.weeklyBackupReminder} onChange={(v) => u({ weeklyBackupReminder: v })} /></Row>
        <Row k={tr('settings.avisar_si_pasan_mas_de')}>
          <select aria-label={tr('settings.dias_sin_respaldo')} value={s.backupReminderDays} onChange={(e) => u({ backupReminderDays: Number((e.target as HTMLSelectElement).value) })}>{[3, 7, 14, 30].map((d) => <option value={d}>{tr('settings.d_dias', { d: d })}</option>)}</select>
        </Row>
        <Row k={tr('settings.importar_archivos_o_restaurar')}><button type="button" class="link" onClick={() => app.openSheet('import')}>{tr('settings.importar')}</button></Row>
      </Group>

      <Group title={tr('settings.integridad')} footer={tr('settings.se_comprueba_al_abrir_engrama_nunca')}>
        <Row k={tr('settings.archivos')} sub={ig ? Object.entries(ig.byFolder).map(([k, n]) => `${k}: ${n}`).join(' · ') || tr('settings.boveda_vacia') : tr('settings.comprobando')}><span class="v">{ig?.files ?? '—'}</span></Row>
        {ig?.problems.map((p) => <Row k={<code style={{ wordBreak: 'break-all' }}>{p.path}</code>} sub={`⚠ ${p.reason}`} />)}
        <Row k={ig?.problems.length ? tr('settings.n_problemas', { n: ig.problems.length }) : tr('settings.sin_problemas')}><button type="button" class="link" onClick={() => void app.recheckIntegrity()}>{tr('settings.comprobar_de_nuevo')}</button></Row>
      </Group>

      <AddonsGroup />

      <Group title={tr('settings.instalar')}>
        {isStandalone() ? <Row k={tr('settings.engrama_esta_instalada')} sub={tr('settings.abierta_desde_la_pantalla_de_inicio')} /> : <div class="row-i"><div class="k"><InstallSteps /></div></div>}
      </Group>

      <Group title={tr('settings.mas')}>
        <Row k={tr('settings.pagina_de_diseno')} sub={tr('settings.componentes_sobre_5_fondos_de_prueba')} onClick={() => (location.hash = href('design'))}><span class="v">›</span></Row>
        <Row k={tr('settings.cargar_boveda_de_ejemplo')} sub={tr('settings.anade_mazos_y_notas_de_muestra')}>
          <button type="button" class="link" onClick={async () => {
            let n = 0;
            for (const f of await exampleFiles()) if (!(await app.vault.exists(f.path))) (await app.vault.write(f.path, f.text), n++);
            app.changed();
            app.toast(n ? tr('settings.ejemplos_anadidos', { n }) : tr('settings.ejemplos_ya'));
          }}>{tr('settings.cargar')}</button>
        </Row>
      </Group>
      <Group title={tr('settings.acerca_de')}>
        <div class="row" style={{ padding: '14px 18px', gap: '16px' }}>
          <img class="brand-logo" src="brand/logo-256.png" width="72" height="72" alt={tr('settings.logo_de_engrama')} style={{ borderRadius: '18px' }} />
          <div><div style={{ fontWeight: 500, fontSize: 'var(--t-3)' }}>{tr('settings.engrama')}</div><div class="foot">{tr('settings.version_app_version_sin_servidores_sin', { APP_VERSION: APP_VERSION })}</div></div>
        </div>
      </Group>
      <div style={{ height: '24px' }} />
    </div>
  );
}
