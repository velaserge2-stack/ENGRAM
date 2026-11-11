import { useApp } from '../state';
import { Group, PageTitle, Row, Switch } from '../ui/kit';

/** Sistema de módulos (SPEC §9): {id, nombre, versión, descripción, hooks}. */
export interface Module {
  id: string;
  name: string;
  version: string;
  description: string;
  defaultOn: boolean;
  hooks: ('onCardShown' | 'onAnswer' | 'renderDashboardTile' | 'registerCommand' | 'registerView')[];
}

export const MODULES: Module[] = [
  { id: 'heatmap', name: 'Mapa de adherencia', version: '1.0', description: 'Cuadrícula de 53×7 días con racha y detalle por día.', defaultOn: true, hooks: ['renderDashboardTile'] },
  { id: 'fsrs-stats', name: 'Estadísticas FSRS', version: '1.0', description: 'Retención real, pronóstico, distribuciones e historial por tarjeta.', defaultOn: true, hooks: ['registerView'] },
  { id: 'occlusion', name: 'Oclusión de imagen', version: '1.0', description: 'Máscaras con dedo o Pencil; ocultar una u ocultar todas.', defaultOn: true, hooks: ['onCardShown'] },
  { id: 'cloze', name: 'Cloze', version: '1.0', description: 'Huecos con pistas y varios números.', defaultOn: true, hooks: ['onCardShown'] },
  { id: 'edit-review', name: 'Editar durante el repaso', version: '1.0', description: 'Corrige una tarjeta sin perder su historial.', defaultOn: true, hooks: ['registerCommand'] },
  { id: 'browser', name: 'Navegador avanzado', version: '1.0', description: 'Consultas tag:, deck:, due:, is:leech, edición por lotes.', defaultOn: true, hooks: ['registerView'] },
  { id: 'tts', name: 'Lectura en voz alta', version: '1.0', description: 'Web Speech con idioma por mazo.', defaultOn: true, hooks: ['onCardShown'] },
  { id: 'tags', name: 'Etiquetas jerárquicas', version: '1.0', description: 'Etiquetas padre/hijo desde una lista controlada.', defaultOn: true, hooks: ['registerView'] },
  { id: 'summary', name: 'Resumen del día', version: '1.0', description: 'Vencidas, nuevas, tiempo y retención en Hoy.', defaultOn: true, hooks: ['renderDashboardTile'] },
  { id: 'xp', name: 'Nivel y XP', version: '0.9', description: '1 XP por repaso, 5 por tarjeta nueva aprendida.', defaultOn: false, hooks: ['onAnswer', 'renderDashboardTile'] },
  { id: 'challenge', name: 'Desafío diario', version: '0.9', description: '"Repasa 30 tarjetas hoy".', defaultOn: false, hooks: ['renderDashboardTile'] },
  { id: 'fact', name: 'Dato del día', version: '0.9', description: 'Una línea al azar de notes/datos.md.', defaultOn: false, hooks: ['renderDashboardTile'] },
];

export function addonOn(s: { addons: Record<string, boolean> }, id: string): boolean {
  return s.addons[id] ?? MODULES.find((m) => m.id === id)?.defaultOn ?? false;
}

export function Addons() {
  const app = useApp();
  return (
    <div class="settings">
      <PageTitle title="Add-ons" sub="Módulos integrados; todo funciona sin conexión." />
      <Group footer="Los módulos solo cambian la interfaz; tus archivos no se modifican al activarlos o desactivarlos.">
        {MODULES.map((m) => (
          <Row k={<>{m.name} <span class="t3 note">v{m.version}</span></>} sub={m.description}>
            <Switch label={m.name} checked={addonOn(app.settings, m.id)} onChange={(v) => app.update({ addons: { ...app.settings.addons, [m.id]: v } })} />
          </Row>
        ))}
      </Group>
    </div>
  );
}
