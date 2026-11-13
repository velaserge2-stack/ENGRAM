import { getLang, setLang, t, type Lang } from '../i18n';
import { Check, HelpCircle, RotateCcw, Zap, Lock, Minimize2, Maximize2, X, FileText, BookOpen, Plus, Inbox, Sparkles } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Background } from '../lib/settings';
import { useApp } from '../state';
import { Bar, Group, KV, PageTitle, Ring, Row, Segmented, Switch } from '../ui/kit';
import { DeckPanel } from './decks';
import { PomodoroPanel } from './pomodoro';
import { InkSurface } from '../ink/InkSurface';
import { emptyInk } from '../ink/model';

/** Fondos de prueba del tema Cristal (§11): blanco, negro, rayas, degradado vivo y foto. */
const TEST_BGS: [string, Background][] = [
  ['blanco', { kind: 'solid', value: '#ffffff' }],
  ['negro', { kind: 'solid', value: '#000000' }],
  ['rayas', { kind: 'builtin', value: 'rayas' }],
  ['degradado', { kind: 'builtin', value: 'neon' }],
  ['foto', { kind: 'builtin', value: 'paisaje' }],
];

export function Design() {
  const app = useApp();
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const bg = q.get('bg') ?? 'foto';
  const mode = (q.get('modo') as 'dark' | 'light') ?? 'dark';
  const nav = (b: string, m: string) => (location.hash = `#/design?bg=${b}&modo=${m}`);
  const setBg = (b: string) => nav(b, mode);
  const setMode = (m: 'dark' | 'light') => nav(bg, m);
  const [sw, setSw] = useState(true);
  const [seg, setSeg] = useState('a');
  useEffect(() => {
    app.previewBg(TEST_BGS.find((b) => b[0] === bg)![1], mode);
  }, [bg, mode]);
  useEffect(() => () => app.previewBg(null), []);
  return (
    <div class="stack">
      <PageTitle title={t('design.diseno_cristal')} sub={t('design.todos_los_componentes_sobre_los_5')}>
        <Segmented label={t('design.fondo_de_prueba')} value={bg} onChange={setBg} options={TEST_BGS.map(([k]) => [k, k[0]!.toUpperCase() + k.slice(1)])} />
        <Segmented label={t('deck.modo')} value={mode} onChange={setMode} options={[['dark', t('design.oscuro')], ['light', t('design.claro')]]} />
        <Segmented<Lang> label={t('design.idioma_de_prueba')} value={getLang()} onChange={(l) => { setLang(l); app.update({ lang: l }, true); }} options={[['es', 'ES'], ['en', 'EN'], ['fr', 'FR'], ['xx', t('design.pseudo')]]} />
      </PageTitle>
      <div class="grid hoy">
        <DeckPanel />
        <div class="side"><PomodoroPanel /></div>
        <div class="grid cards3 span-all">
          <section class="glass panel statcard"><h3>{t('today.progreso_de_hoy')}</h3><KV k={t('today.estudiadas')} v={177} /><KV k={t('today.tiempo_min')} v={41} /><KV k={t('today.ritmo_s_tarjeta')} v={14} /><KV k={t('today.aciertos')} v="88 %" /></section>
          <section class="glass panel statcard"><h3>{t('today.pendientes')}</h3><KV k={t('today.nuevas')} v={12} /><KV k={t('today.aprendiendo')} v={0} /><KV k={t('today.vencidas')} v={34} strong /><KV k={t('today.total')} v={46} /></section>
          <section class="glass panel statcard center"><h3>{t('design.retencion')}</h3><Ring value={0.91} label={t('design.retencion')} /><Bar value={0.7} label={t('design.precision')} /><Bar value={0.4} label={t('design.sin_datos')} outline /></section>
        </div>
      </div>
      <section class="glass panel stack">
        <h2 style={{ fontSize: 'var(--t-2)' }}>{t('design.calificacion')}</h2>
        <div class="grades" style={{ padding: 0 }}>
          <button type="button" class="grade"><RotateCcw size={18} />{' '}{t('design.otra_vez')}<span class="iv">{t('design.10_min')}</span></button>
          <button type="button" class="grade"><HelpCircle size={18} />{' '}{t('design.dificil')}<span class="iv">{t('design.3_d')}</span></button>
          <button type="button" class="grade inv"><Check size={18} />{' '}{t('design.bien')}<span class="iv">{t('design.8_d')}</span></button>
          <button type="button" class="grade suggested"><Zap size={18} />{' '}{t('design.facil')}<span class="iv">{t('design.19_d')}</span></button>
        </div>
        <h2 style={{ fontSize: 'var(--t-2)' }}>{t('design.botones_chips_y_estados')}</h2>
        <div class="row wrap">
          <button type="button" class="btn primary">{t('design.primario')}</button><button type="button" class="btn">{t('design.normal')}</button><button type="button" class="btn outline">{t('design.contorno')}</button>
          <button type="button" class="btn" disabled>{t('design.deshabilitado')}</button><button type="button" class="btn danger">{t('calendar.eliminar')}</button>
          <span class="chip">{t('design.contorno')}</span><span class="chip solid">{t('design.activo')}</span><span class="count">7</span><span class="count zero">0</span>
        </div>
        <div class="row wrap"><span class="row">{t('design.en_ritmo')}</span><span class="row">{t('design.ajustado')}</span><span class="row">{t('design.atrasado')}</span></div>
        <div class="err">{t('design.error_icono_texto_en_negrita_y')}</div>
        <div class="row wrap"><Switch label={t('design.interruptor')} checked={sw} onChange={setSw} /><Segmented label={t('design.segmentado')} value={seg} onChange={setSeg} options={[['a', t('design.uno')], ['b', t('design.dos')], ['c', t('design.tres')]]} /><input class="input" placeholder={t('design.campo_de_texto')} aria-label={t('design.campo_de_texto')} /><input type="range" aria-label={t('design.deslizador')} /></div>
        <div class="legend">menos {[0, 1, 2, 3, 4].map((l) => <span class="c" data-l={l} />)}{' '}{t('design.mas')}</div>
      </section>
      <Group title={t('design.lista_agrupada')} footer={t('design.filas_44')}>
        <Row k={t('design.fila_con_valor')} sub={t('design.detalle')}><span class="v">12</span></Row>
        <Row k={t('design.fila_con_interruptor')}><Switch label={t('design.ejemplo')} checked={!sw} onChange={(v) => setSw(!v)} /></Row>
      </Group>
      <div class="spaces" style={{ minHeight: '0' }}>
        <nav class="rail glass" aria-label={t('design.espacios_de_ejemplo')}><button type="button" aria-current="true">🫀</button><button type="button">🧠</button><button type="button" aria-label={t('design.nuevo')}><Plus size={20} /></button></nav>
        <div class="stack">
          <section class="win glass focused" style={{ height: '220px' }} aria-label={t('design.ventana_de_ejemplo')}>
            <header class="win-bar"><FileText size={18} /><span class="t">guia-ecg.pdf</span><span class="chip">PDF</span><span class="grow" /><button type="button" class="btn icon small ghost" aria-label={t('design.bloquear')}><Lock size={16} /></button><button type="button" class="btn icon small ghost" aria-label={t('design.minimizar')}><Minimize2 size={16} /></button><button type="button" class="btn icon small ghost" aria-label={t('design.expandir')}><Maximize2 size={16} /></button><button type="button" class="btn icon small ghost" aria-label={t('design.cerrar')}><X size={16} /></button></header>
            <div class="win-body" style={{ padding: '14px' }}><p>{t('design.ventana_enfocada_borde_mas_claro_y')}</p></div>
          </section>
          <section class="win glass" style={{ height: '140px' }} aria-label={t('design.ventana_sin_foco')}><header class="win-bar"><BookOpen size={18} /><span class="t">{t('design.estudio')}</span><span class="chip">{t('design.estudio')}</span></header><div class="win-body" style={{ padding: '14px' }}><p class="t2">{t('design.texto_secundario_sobre_vidrio')}</p></div></section>
          <div class="dock" style={{ position: 'static' }}>
            <span class="pill glass"><Sparkles size={16} />{' '}{t('design.extras')}</span>
            <div class="glass"><span class="note t2" style={{ padding: '0 10px' }}><Plus size={14} />{' '}{t('design.anadir_panel')}</span><button type="button" class="btn icon small ghost" aria-label="PDF"><FileText size={18} /></button><button type="button" class="btn icon small ghost" aria-label={t('design.estudio')}><BookOpen size={18} /></button></div>
            <span class="pill glass"><Inbox size={16} />{' '}{t('app.bandeja')}{' '}<span class="count">3</span></span>
          </div>
        </div>
      </div>
      <section class="study-card glass strong"><p>{t('design.superficie_de_lectura_larga_glass_strong')}</p><p class="t2">{t('design.texto_secundario')}</p></section>
      <InkDemo />
    </div>
  );
}

/** Superficie de prueba del motor de tinta (Prompt 5 · B): Pencil, palma, herramientas. */
function InkDemo() {
  const [doc, setDoc] = useState(emptyInk());
  return (
    <section class="glass strong panel stack-s ink-demo" aria-label={t('ink.superficie_de_prueba')}>
      <h2 style={{ fontSize: 'var(--t-3)' }}>{t('ink.superficie_de_prueba')}</h2>
      <p class="foot" data-testid="ink-count">{doc.strokes.length}</p>
      <InkSurface doc={doc} onChange={setDoc} width={560} height={260} label={t('ink.superficie_de_prueba')} />
    </section>
  );
}
