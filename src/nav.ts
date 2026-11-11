import { t } from './i18n';
import { BarChart3, BookOpen, CalendarDays, ClipboardCheck, Layers, LayoutGrid, NotebookPen, Search, Sun } from 'lucide-preact';

/** Barra superior en píldora (Cristal §7.1). */
export const TABS = [
  { id: 'hoy', get label() { return t('today.hoy'); }, icon: Sun },
  { id: 'mazos', get label() { return t('decks.mazos'); }, icon: Layers },
  { id: 'estudiar', get label() { return t('today.estudiar'); }, icon: BookOpen },
  { id: 'explorar', get label() { return t('explorar.explorar'); }, icon: Search },
  { id: 'simulacros', get label() { return t('calendar.simulacros'); }, icon: ClipboardCheck },
  { id: 'calendario', get label() { return t('calendar.calendario'); }, icon: CalendarDays },
  { id: 'notas', get label() { return t('notes.notas'); }, icon: NotebookPen },
  { id: 'espacios', get label() { return t('spaces.espacios'); }, icon: LayoutGrid },
  { id: 'estadisticas', get label() { return t('spaces.estadisticas'); }, icon: BarChart3 },
] as const;

export type Route = (typeof TABS)[number]['id'] | 'ajustes' | 'bandeja' | 'addons' | 'design';
