import { BarChart3, BookOpen, CalendarDays, ClipboardCheck, Layers, LayoutGrid, NotebookPen, Search, Sun } from 'lucide-preact';

/** Barra superior en píldora (Cristal §7.1). */
export const TABS = [
  { id: 'hoy', label: 'Hoy', icon: Sun },
  { id: 'mazos', label: 'Mazos', icon: Layers },
  { id: 'estudiar', label: 'Estudiar', icon: BookOpen },
  { id: 'explorar', label: 'Explorar', icon: Search },
  { id: 'simulacros', label: 'Simulacros', icon: ClipboardCheck },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
  { id: 'notas', label: 'Notas', icon: NotebookPen },
  { id: 'espacios', label: 'Espacios', icon: LayoutGrid },
  { id: 'estadisticas', label: 'Estadísticas', icon: BarChart3 },
] as const;

export type Route = (typeof TABS)[number]['id'] | 'ajustes' | 'bandeja' | 'addons' | 'design';
