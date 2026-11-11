import { BarChart3, BookOpen, CalendarDays, ClipboardCheck, Layers, LayoutGrid, NotebookPen, Puzzle, Settings, Sun } from 'lucide-preact';

/** Pestañas de la SPEC §7. `phase`: fase en la que se construye (las futuras muestran un vacío útil). */
export const TABS = [
  { id: 'hoy', label: 'Hoy', icon: Sun, phase: 1, primary: true },
  { id: 'mazos', label: 'Mazos', icon: Layers, phase: 1, primary: true },
  { id: 'estudiar', label: 'Estudiar', icon: BookOpen, phase: 2, primary: true },
  { id: 'simulacros', label: 'Simulacros', icon: ClipboardCheck, phase: 7 },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays, phase: 11 },
  { id: 'notas', label: 'Notas', icon: NotebookPen, phase: 4, primary: true },
  { id: 'espacios', label: 'Espacios', icon: LayoutGrid, phase: 9 },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3, phase: 3 },
  { id: 'addons', label: 'Add-ons', icon: Puzzle, phase: 3 },
  { id: 'ajustes', label: 'Ajustes', icon: Settings, phase: 1, primary: true },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const TAB_INFO: Partial<Record<TabId, string>> = {
  estudiar: 'Repaso con FSRS: cuatro botones con el intervalo previsto, "¿Por qué esta fecha?", sanguijuelas y modo recuperación.',
  simulacros: 'Exámenes de práctica con cronómetro, banco de preguntas e importador con vista previa.',
  calendario: 'Pronóstico de repasos, exámenes, bloques de estudio y exportación a .ics.',
  notas: 'Materia → Tema → Notas, con editor en vivo, plantillas y exportación a .md, .docx y .pdf.',
  espacios: 'Paneles en mosaico con PDF, notas y tarjetas que comparten datos.',
  estadisticas: 'Retención real, pronóstico de 30 días y distribución de estabilidad y dificultad.',
  addons: 'Módulos integrados que se activan o desactivan: mapa de adherencia, voz, navegador avanzado…',
};
