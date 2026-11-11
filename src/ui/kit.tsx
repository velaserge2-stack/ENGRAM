import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="switch">
      <input type="checkbox" role="switch" aria-label={props.label} checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span />
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map(([v, t]) => (
        <button type="button" key={v} aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function Row(props: { k: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren; onClick?: () => void }) {
  return (
    <div class={`row-i${props.onClick ? ' tap' : ''}`} onClick={props.onClick} role={props.onClick ? 'button' : undefined} tabIndex={props.onClick ? 0 : undefined}>
      <div class="k">
        {props.k}
        {props.sub && <small>{props.sub}</small>}
      </div>
      {props.children}
    </div>
  );
}

export function Group(props: { title?: string; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="group glass" style={{ marginTop: '18px' }} aria-label={props.title}>
      {props.title && <h2 class="group-h">{props.title}</h2>}
      {props.children}
      {props.footer && <p class="group-f">{props.footer}</p>}
    </section>
  );
}

/** Hoja modal con "grabber". Esc o tocar fuera la cierra. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`sheet glass strong${props.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
        <div class="grabber" aria-hidden="true" />
        <div class="sheet-h">
          <h2>{props.title}</h2>
          <div class="row">
            {props.actions}
            <button type="button" class="btn icon small" aria-label="Cerrar" onClick={props.onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div class="sheet-b">{props.children}</div>
      </div>
    </div>
  );
}

export function PageTitle(props: { title: ComponentChildren; sub?: string; children?: ComponentChildren }) {
  return (
    <header class="page-title glass">
      <div>
        <h1>{props.title}</h1>
        {props.sub && <div class="sub">{props.sub}</div>}
      </div>
      {props.children && <div class="row wrap">{props.children}</div>}
    </header>
  );
}

export function Empty(props: { icon: JSX.Element; title: string; children: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty glass">
      {props.icon}
      <h2>{props.title}</h2>
      <p>{props.children}</p>
      {props.action}
    </div>
  );
}

/** Valor con estado sin color: cero al 38 %, distinto de cero al 100 %. */
export function Num(props: { n: number | string; strong?: boolean }) {
  const zero = props.n === 0 || props.n === '0';
  return <span class={`num${zero ? ' t3' : ''}`} style={props.strong && !zero ? { fontWeight: 800 } : undefined}>{props.n}</span>;
}

export function KV(props: { k: string; v: number | string; strong?: boolean }) {
  const zero = props.v === 0 || props.v === '0' || props.v === '—';
  return (
    <div class="kv">
      <span class="k">{props.k}</span>
      <span class={`v${zero ? ' zero' : ''}`} style={props.strong && !zero ? { fontWeight: 800 } : undefined}>{props.v}</span>
    </div>
  );
}

export function Ring(props: { value: number; size?: number; label: string; text?: string; class?: string }) {
  const s = props.size ?? 96;
  const r = s / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <svg class={`ring ${props.class ?? ''}`} width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={`${props.label}: ${props.text ?? Math.round(v * 100) + ' %'}`}>
      <circle class="track" cx={s / 2} cy={s / 2} r={r} fill="none" stroke-width="7" />
      <circle class="val" cx={s / 2} cy={s / 2} r={r} fill="none" stroke-width="7" stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - v)} transform={`rotate(-90 ${s / 2} ${s / 2})`} />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" style={{ fill: 'var(--t1)', fontSize: `${s / 5}px`, fontWeight: 600 }}>
        {props.text ?? `${Math.round(v * 100)}%`}
      </text>
    </svg>
  );
}

export function Bar(props: { value: number; label: string; outline?: boolean }) {
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <div class={`bar${props.outline ? ' outline' : ''}`} role="meter" aria-label={props.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  );
}
