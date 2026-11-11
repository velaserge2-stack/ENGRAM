import { Check, HelpCircle, RotateCcw, Zap, Lock, Minimize2, Maximize2, X, FileText, BookOpen, Plus, Inbox, Sparkles } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Background } from '../lib/settings';
import { useApp } from '../state';
import { Bar, Group, KV, PageTitle, Ring, Row, Segmented, Switch } from '../ui/kit';
import { DeckPanel } from './decks';
import { PomodoroPanel } from './pomodoro';

/** Fondos de prueba del tema Cristal (§11): blanco, negro, rayas, degradado vivo y foto. */
export const TEST_BGS: [string, Background][] = [
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
      <PageTitle title="Diseño · Cristal" sub="Todos los componentes sobre los 5 fondos de prueba. La interfaz no tiene color.">
        <Segmented label="Fondo de prueba" value={bg} onChange={setBg} options={TEST_BGS.map(([k]) => [k, k[0]!.toUpperCase() + k.slice(1)])} />
        <Segmented label="Modo" value={mode} onChange={setMode} options={[['dark', 'Oscuro'], ['light', 'Claro']]} />
      </PageTitle>
      <div class="grid hoy">
        <DeckPanel />
        <div class="side"><PomodoroPanel /></div>
        <div class="grid cards3 span-all">
          <section class="glass panel statcard"><h3>Progreso de hoy</h3><KV k="Estudiadas" v={177} /><KV k="Tiempo (min)" v={41} /><KV k="Ritmo (s/tarjeta)" v={14} /><KV k="Aciertos" v="88 %" /></section>
          <section class="glass panel statcard"><h3>Pendientes</h3><KV k="Nuevas" v={12} /><KV k="Aprendiendo" v={0} /><KV k="Vencidas" v={34} strong /><KV k="Total" v={46} /></section>
          <section class="glass panel statcard center"><h3>Retención</h3><Ring value={0.91} label="Retención" /><Bar value={0.7} label="Precisión" /><Bar value={0.4} label="Sin datos" outline /></section>
        </div>
      </div>
      <section class="glass panel stack">
        <h2 style={{ fontSize: 'var(--t-2)' }}>Calificación</h2>
        <div class="grades" style={{ padding: 0 }}>
          <button type="button" class="grade"><RotateCcw size={18} /> Otra vez<span class="iv">10 min</span></button>
          <button type="button" class="grade"><HelpCircle size={18} /> Difícil<span class="iv">3 d</span></button>
          <button type="button" class="grade inv"><Check size={18} /> Bien<span class="iv">8 d</span></button>
          <button type="button" class="grade suggested"><Zap size={18} /> Fácil<span class="iv">19 d</span></button>
        </div>
        <h2 style={{ fontSize: 'var(--t-2)' }}>Botones, chips y estados</h2>
        <div class="row wrap">
          <button type="button" class="btn primary">Primario</button><button type="button" class="btn">Normal</button><button type="button" class="btn outline">Contorno</button>
          <button type="button" class="btn" disabled>Deshabilitado</button><button type="button" class="btn danger">Eliminar</button>
          <span class="chip">Contorno</span><span class="chip solid">Activo</span><span class="count">7</span><span class="count zero">0</span>
        </div>
        <div class="row wrap"><span class="row">✓ En ritmo</span><span class="row">◐ Ajustado</span><span class="row">⚠ Atrasado</span></div>
        <div class="err">⚠ Error: icono, texto en negrita y borde más grueso; sin rojo.</div>
        <div class="row wrap"><Switch label="Interruptor" checked={sw} onChange={setSw} /><Segmented label="Segmentado" value={seg} onChange={setSeg} options={[['a', 'Uno'], ['b', 'Dos'], ['c', 'Tres']]} /><input class="input" placeholder="Campo de texto" aria-label="Campo de texto" /><input type="range" aria-label="Deslizador" /></div>
        <div class="legend">menos {[0, 1, 2, 3, 4].map((l) => <span class="c" data-l={l} />)} más</div>
      </section>
      <Group title="Lista agrupada" footer="Filas de ≥ 44 px, separadores finos.">
        <Row k="Fila con valor" sub="Detalle"><span class="v">12</span></Row>
        <Row k="Fila con interruptor"><Switch label="Ejemplo" checked={!sw} onChange={(v) => setSw(!v)} /></Row>
      </Group>
      <div class="spaces" style={{ minHeight: '0' }}>
        <nav class="rail glass" aria-label="Espacios de ejemplo"><button type="button" aria-current="true">🫀</button><button type="button">🧠</button><button type="button" aria-label="Nuevo"><Plus size={20} /></button></nav>
        <div class="stack">
          <section class="win glass focused" style={{ height: '220px' }} aria-label="Ventana de ejemplo">
            <header class="win-bar"><FileText size={18} /><span class="t">guia-ecg.pdf</span><span class="chip">PDF</span><span class="grow" /><button type="button" class="btn icon small ghost" aria-label="Bloquear"><Lock size={16} /></button><button type="button" class="btn icon small ghost" aria-label="Minimizar"><Minimize2 size={16} /></button><button type="button" class="btn icon small ghost" aria-label="Expandir"><Maximize2 size={16} /></button><button type="button" class="btn icon small ghost" aria-label="Cerrar"><X size={16} /></button></header>
            <div class="win-body" style={{ padding: '14px' }}><p>Ventana enfocada: borde más claro y sombra más profunda, no color.</p></div>
          </section>
          <section class="win glass" style={{ height: '140px' }} aria-label="Ventana sin foco"><header class="win-bar"><BookOpen size={18} /><span class="t">Estudio</span><span class="chip">Estudio</span></header><div class="win-body" style={{ padding: '14px' }}><p class="t2">Texto secundario sobre vidrio.</p></div></section>
          <div class="dock" style={{ position: 'static' }}>
            <span class="pill glass"><Sparkles size={16} /> Extras</span>
            <div class="glass"><span class="note t2" style={{ padding: '0 10px' }}><Plus size={14} /> Añadir panel</span><button type="button" class="btn icon small ghost" aria-label="PDF"><FileText size={18} /></button><button type="button" class="btn icon small ghost" aria-label="Estudio"><BookOpen size={18} /></button></div>
            <span class="pill glass"><Inbox size={16} /> Bandeja <span class="count">3</span></span>
          </div>
        </div>
      </div>
      <section class="study-card glass strong"><p>Superficie de lectura larga (--glass-strong ≥ 78 %): tarjeta de estudio, editor de notas, simulacro.</p><p class="t2">Texto secundario.</p></section>
    </div>
  );
}
