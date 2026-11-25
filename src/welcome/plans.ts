// Planes y precios de la página de bienvenida: se cambian SOLO aquí.
// `name`, `desc` y los valores de `rows` son claves de i18n (`bienvenida.*`); el precio es un número en dólares.
export const PRICE_PERIOD = 'bienvenida.per'; // «/ mes» (supuesto: el periodo no está definido aún)
export const CURRENCY = 'US$';

export interface Plan {
  id: string;
  name: string;
  desc: string;
  price: number;
  /** Hoy solo «Gratis» está disponible; los de pago llevan «Próximamente». */
  soon: boolean;
  /** Filas: [etiqueta, valor] (claves de i18n). */
  rows: [string, string][];
}

export const PLANS: Plan[] = [
  { id: 'gratis', name: 'bienvenida.plan_gratis', desc: 'bienvenida.pl_gratis_d', price: 0, soon: false, rows: [
    ['bienvenida.r_app', 'bienvenida.v_si'], ['bienvenida.r_cta', 'bienvenida.v_si'], ['bienvenida.r_off', 'bienvenida.v_si'], ['bienvenida.r_as', 'bienvenida.v_clave'],
  ] },
  { id: 'esencial', name: 'bienvenida.plan_esencial', desc: 'bienvenida.pl_esencial_d', price: 5, soon: true, rows: [
    ['bienvenida.r_ia', 'bienvenida.v_si'], ['bienvenida.r_mod', 'bienvenida.v_algunos'], ['bienvenida.r_uso', 'bienvenida.v_basico'], ['bienvenida.r_pri', 'bienvenida.v_pnormal'],
  ] },
  { id: 'plus', name: 'bienvenida.plan_plus', desc: 'bienvenida.pl_plus_d', price: 10, soon: true, rows: [
    ['bienvenida.r_ia', 'bienvenida.v_si'], ['bienvenida.r_mod', 'bienvenida.v_varios'], ['bienvenida.r_uso', 'bienvenida.v_ampliado'], ['bienvenida.r_pri', 'bienvenida.v_palta'],
  ] },
  { id: 'pro', name: 'bienvenida.plan_pro', desc: 'bienvenida.pl_pro_d', price: 20, soon: true, rows: [
    ['bienvenida.r_ia', 'bienvenida.v_si'], ['bienvenida.r_mod', 'bienvenida.v_todos'], ['bienvenida.r_uso', 'bienvenida.v_maximo'], ['bienvenida.r_pri', 'bienvenida.v_pmax'],
  ] },
];
