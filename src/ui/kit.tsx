import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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

export function Row(props: { k: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="row-i">
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
    <section>
      {props.title && <h2 class="group-h">{props.title}</h2>}
      <div class="group">{props.children}</div>
      {props.footer && <p class="group-f">{props.footer}</p>}
    </section>
  );
}

/** Hoja modal con "grabber". Esc o tocar fuera la cierra. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; actions?: ComponentChildren }) {
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
      <div class="sheet glass dense" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={ref}>
        <div class="grabber" aria-hidden="true" />
        <div class="sheet-h">
          <h2>{props.title}</h2>
          <div class="toolbar">
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

/** Título grande que se colapsa en una barra al desplazar (patrón de iPadOS). */
export function LargeTitle(props: { title: string; sub?: string; children?: ComponentChildren }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div class={`navbar glass${collapsed ? ' show' : ''}`} aria-hidden={!collapsed}>
        <span class="t">{props.title}</span>
      </div>
      <header class="page large-title">
        <div>
          <h1>{props.title}</h1>
          {props.sub && <div class="sub">{props.sub}</div>}
        </div>
        {props.children && <div class="toolbar">{props.children}</div>}
      </header>
      <div ref={sentinel} style={{ height: '1px', marginTop: '-1px' }} />
    </>
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
