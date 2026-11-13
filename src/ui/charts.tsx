/** Gráficas sin color: grosor, trazo (continuo/punteado) y trama; leyenda con forma. */
function Defs() {
  return (
    <defs>
      <pattern id="trama" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill="transparent" />
        <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: 'var(--t2)' }} stroke-width="2" />
      </pattern>
    </defs>
  );
}

export function Bars(props: { data: { label: string; n: number; hi?: boolean }[]; height?: number; label: string; every?: number }) {
  const W = 600;
  const H = props.height ?? 160;
  const max = Math.max(1, ...props.data.map((d) => d.n));
  const bw = W / props.data.length;
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={props.label}>
      <Defs />
      <line class="axis" x1="0" x2={W} y1={H} y2={H} />
      {props.data.map((d, i) => {
        const h = (d.n / max) * (H - 14);
        return (
          <g key={i}>
            <rect class={d.hi ? 'b1' : 'b2'} x={i * bw + 2} y={H - h} width={Math.max(1, bw - 4)} height={h} rx="2"><title>{`${d.label}: ${d.n}`}</title></rect>
            {i % (props.every ?? 5) === 0 && <text x={i * bw + bw / 2} y={H + 13} text-anchor="middle">{d.label}</text>}
          </g>
        );
      })}
      <text x="2" y="10">{max}</text>
    </svg>
  );
}

export function Lines(props: { a: number[]; b?: number[]; labels: string[]; label: string; legend?: [string, string] }) {
  const W = 600;
  const H = 150;
  const max = Math.max(1, ...props.a, ...(props.b ?? []));
  const pts = (arr: number[]) => arr.map((v, i) => `${(i / Math.max(1, arr.length - 1)) * W},${H - (v / max) * (H - 12)}`).join(' ');
  return (
    <div>
      <svg class="chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={props.label}>
        <line class="axis" x1="0" x2={W} y1={H} y2={H} />
        <polyline class="l1" points={pts(props.a)} />
        {props.b && <polyline class="l2" points={pts(props.b)} />}
        {props.labels.map((l, i) => (i % 7 === 0 ? <text x={(i / Math.max(1, props.labels.length - 1)) * W} y={H + 13} text-anchor="middle">{l}</text> : null))}
        <text x="2" y="10">{Math.round(max)}</text>
      </svg>
      {props.legend && (
        <div class="row foot" style={{ gap: '16px' }}>
          <span class="row"><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" style={{ stroke: 'var(--t1)' }} stroke-width="2" /></svg>{props.legend[0]}</span>
          <span class="row"><svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" style={{ stroke: 'var(--t2)' }} stroke-width="1.5" stroke-dasharray="4 3" /></svg>{props.legend[1]}</span>
        </div>
      )}
    </div>
  );
}
