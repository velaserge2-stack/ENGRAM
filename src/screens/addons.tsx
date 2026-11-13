import { t } from '../i18n';
import { useApp } from '../state';
import { Group, Row, Switch } from '../ui/kit';

/** Sistema de módulos (SPEC §9): {id, nombre, versión, descripción, hooks}. */
export interface Module {
  id: string;
  name: string;
  version: string;
  description: string;
  defaultOn: boolean;
  hooks: ('onCardShown' | 'onAnswer' | 'renderDashboardTile' | 'registerCommand' | 'registerView')[];
}

export const MODULES = (): Module[] => ([
  { id: 'heatmap', name: t('addons.n_heatmap'), version: '1.0', description: t('addons.cuadricula_de_53_7_dias_con'), defaultOn: true, hooks: ['renderDashboardTile'] },
  { id: 'fsrs-stats', name: t('addons.n_fsrs'), version: '1.0', description: t('addons.retencion_real_pronostico_distribuciones_e'), defaultOn: true, hooks: ['registerView'] },
  { id: 'occlusion', name: t('addons.n_occlusion'), version: '1.0', description: t('addons.mascaras_con_dedo_o_pencil_ocultar'), defaultOn: true, hooks: ['onCardShown'] },
  { id: 'cloze', name: t('addons.n_cloze'), version: '1.0', description: t('addons.huecos_con_pistas_y_varios_numeros'), defaultOn: true, hooks: ['onCardShown'] },
  { id: 'edit-review', name: t('addons.n_edit'), version: '1.0', description: t('addons.corrige_una_tarjeta_sin_perder_su'), defaultOn: true, hooks: ['registerCommand'] },
  { id: 'browser', name: t('addons.n_browser'), version: '1.0', description: t('addons.consultas_tag_deck_due_is_leech'), defaultOn: true, hooks: ['registerView'] },
  { id: 'tts', name: t('addons.n_tts'), version: '1.0', description: t('addons.web_speech_con_idioma_por_mazo'), defaultOn: true, hooks: ['onCardShown'] },
  { id: 'tags', name: t('addons.n_tags'), version: '1.0', description: t('addons.etiquetas_padre_hijo_desde_una_lista'), defaultOn: true, hooks: ['registerView'] },
  { id: 'summary', name: t('addons.n_summary'), version: '1.0', description: t('addons.vencidas_nuevas_tiempo_y_retencion_en'), defaultOn: true, hooks: ['renderDashboardTile'] },
  { id: 'xp', name: t('addons.n_xp'), version: '0.9', description: t('addons.1_xp_por_repaso_5_por'), defaultOn: false, hooks: ['onAnswer', 'renderDashboardTile'] },
  { id: 'challenge', name: t('addons.n_challenge'), version: '0.9', description: t('addons.repasa_30_tarjetas_hoy'), defaultOn: false, hooks: ['renderDashboardTile'] },
  { id: 'fact', name: t('addons.n_fact'), version: '0.9', description: t('addons.una_linea_al_azar_de_notes'), defaultOn: false, hooks: ['renderDashboardTile'] },
  { id: 'ambient', name: t('addons.n_ambient'), version: '1.0', description: t('addons.ambient_desc'), defaultOn: false, hooks: ['registerView'] },
  // Prompt 6 · C: oculta por ahora; apagada no se muestra ni cuenta pendientes (inbox/ no se toca)
  // Prompt 19: mosaicos de Hoy; apagados no cargan su código (import())
  { id: 'sticky-notes', name: t('addons.n_stickies'), version: '1.0', description: t('addons.stickies_desc'), defaultOn: false, hooks: ['renderDashboardTile'] },
  { id: 'tasks', name: t('addons.n_tasks'), version: '1.0', description: t('addons.tasks_desc'), defaultOn: false, hooks: ['renderDashboardTile'] },
  { id: 'inbox', name: t('addons.n_inbox'), version: '1.0', description: t('addons.inbox_desc'), defaultOn: false, hooks: ['registerView'] },
]);

export function addonOn(s: { addons: Record<string, boolean> }, id: string): boolean {
  return s.addons[id] ?? MODULES().find((m) => m.id === id)?.defaultOn ?? false;
}

/** Sección «Add-ons» de Ajustes (Mejoras 2 · C6: ya no está en la navegación principal). */
export function AddonsGroup() {
  const app = useApp();
  return (
    <Group id="addons" title={t('addons.add_ons')} footer={<>{t('addons.modulos_integrados_todo_funciona_sin_conex')} {t('addons.los_modulos_solo_cambian_la_interfaz')}</>}>
      {MODULES().map((m) => (
        <Row k={<>{m.name} <span class="t3 note">v{m.version}</span></>} sub={m.description}>
          <Switch label={m.name} checked={addonOn(app.settings, m.id)} onChange={(v) => app.update({ addons: { ...app.settings.addons, [m.id]: v } })} />
        </Row>
      ))}
    </Group>
  );
}
