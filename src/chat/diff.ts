// Diferencia legible entre dos textos: líneas quitadas («− ») y añadidas («+ ») entre el prefijo y el sufijo comunes, con una línea de contexto.
export const MAX_DIFF = 40;
export function diffLines(a: string, b: string): string[] {
  const x = a.split('\n'), y = b.split('\n');
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  const cut = (s: string) => (s.length > 160 ? s.slice(0, 159) + '…' : s);
  const out = [
    ...(i > 0 && x[i - 1]!.trim() ? [`  ${cut(x[i - 1]!)}`] : []),
    ...x.slice(i, x.length - j).map((l) => `− ${cut(l)}`),
    ...y.slice(i, y.length - j).map((l) => `+ ${cut(l)}`),
  ].filter((l) => l.trim() !== '−' && l.trim() !== '+');
  return out.length > MAX_DIFF ? [...out.slice(0, MAX_DIFF), `… (+${out.length - MAX_DIFF})`] : out;
}
