/** Bóveda de ejemplo empaquetada (examples/boveda). Solo texto; se carga bajo demanda. */
export async function exampleFiles(): Promise<{ path: string; text: string }[]> {
  const mods = import.meta.glob('../../examples/boveda/**/*.{md,ics}', { query: '?raw', import: 'default' });
  const out: { path: string; text: string }[] = [];
  for (const [k, load] of Object.entries(mods)) {
    out.push({ path: k.replace(/^.*examples\/boveda\//, ''), text: (await load()) as string });
  }
  return out;
}
