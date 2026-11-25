// Iconos de la presentación (trazo 2, estilo Lucide). Cadenas fijas: nada del usuario entra aquí.
const I: Record<string, string> = {
  cards: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5v2M12.5 20.5l1-3.5 5.5-5.5 2.5 2.5-5.5 5.5z"/>',
  flow: '<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
  exam: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4h6v3H9zM9 14l2 2 4-4"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  off: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  undo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  add: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M4 21h16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};

export function Ic(p: { n: string; size?: number }) {
  if (p.n === 'grex') {
    return (
      <svg class="bv-grex" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <defs><linearGradient id="bv-gg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--face)" /><stop offset="1" style="stop-color:var(--face2)" /></linearGradient></defs>
        <ellipse cx="32" cy="60.5" rx="16" ry="2.2" fill="var(--cheek)" />
        <rect x="6" y="7" width="52" height="50" rx="20" fill="url(#bv-gg)" stroke="var(--edge)" stroke-width="1" />
        <ellipse cx="24" cy="30" rx="3.1" ry="4.1" fill="var(--feat)" /><ellipse cx="40" cy="30" rx="3.1" ry="4.1" fill="var(--feat)" />
        <circle cx="25.2" cy="28.4" r="1.15" fill="#fff" /><circle cx="41.2" cy="28.4" r="1.15" fill="#fff" />
        <ellipse cx="16.5" cy="38.5" rx="4" ry="2.5" fill="var(--cheek)" /><ellipse cx="47.5" cy="38.5" rx="4" ry="2.5" fill="var(--cheek)" />
        <path d="M28.5 38.6q3.5 3.4 7 0" fill="none" stroke="var(--feat)" stroke-width="2" stroke-linecap="round" />
      </svg>
    );
  }
  return <svg class="bv-ic" style={p.size ? { width: `${p.size}px`, height: `${p.size}px` } : undefined} viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: I[p.n] ?? '' }} />;
}
