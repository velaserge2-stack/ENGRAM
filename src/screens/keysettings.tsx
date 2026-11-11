import { t } from '../i18n';
import { Gamepad2, Keyboard, RotateCcw } from 'lucide-preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { ACTIONS, bindingOf, conflicts, defaultConfig, type KeyConfig, keysOf, PAD_NAMES, padOf, RESERVED, type Scope, showKey } from '../lib/keys';
import { useApp } from '../state';
import { actionLabel, keymap, useKeymap } from '../ui/keys';
import { Group, Row, Switch } from '../ui/kit';

const SCOPES: Scope[] = ['global', 'study', 'sim', 'ink'];

/**
 * Ajustes → Atajos (Prompt 5 · E): reasignar teclas (también las de un clicker o pedal, que
 * envían PageUp/PageDown, flechas o Intro), restablecer, avisos de conflicto y «Asignar
 * botones» del mando: se pulsa el botón y queda asignado. Se guarda en .app/atajos.json.
 */
export function KeySettings() {
  const app = useApp();
  const cfg = useKeymap();
  const [capture, setCapture] = useState<{ id: string; kind: 'key' | 'pad' } | null>(null);
  const [pads, setPads] = useState<string[]>([]);
  const save = (c: KeyConfig) => void keymap.save(app.vault, c);
  const conf = conflicts(cfg);

  // mandos conectados
  useEffect(() => {
    if (!('getGamepads' in navigator)) return;
    const read = () => setPads([...navigator.getGamepads()].filter(Boolean).map((g) => g!.id));
    read();
    addEventListener('gamepadconnected', read);
    addEventListener('gamepaddisconnected', read);
    return () => (removeEventListener('gamepadconnected', read), removeEventListener('gamepaddisconnected', read));
  }, []);

  // capturar la próxima tecla o el próximo botón del mando (síncrono: la tecla puede llegar en el mismo cuadro)
  useLayoutEffect(() => {
    if (!capture) return;
    if (capture.kind === 'key') {
      const onKey = (e: KeyboardEvent) => {
        const b = bindingOf(e);
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        if (b === 'Escape' && capture.id !== 'study.exit') return setCapture(null);
        if (RESERVED.includes(b)) return app.toast(t('keys.reservada', { k: showKey(b) }));
        save({ ...cfg, keys: { ...cfg.keys, [capture.id]: [b] } });
        setCapture(null);
      };
      addEventListener('keydown', onKey, true);
      return () => removeEventListener('keydown', onKey, true);
    }
    let raf = 0;
    const base = new Map<number, boolean[]>();
    const loop = () => {
      for (const g of navigator.getGamepads?.() ?? []) {
        if (!g) continue;
        const was = base.get(g.index);
        const now = g.buttons.map((x) => x.pressed);
        if (was) {
          const i = now.findIndex((p, k) => p && !was[k]);
          if (i >= 0) { save({ ...cfg, pad: { ...cfg.pad, [capture.id]: [i] } }); setCapture(null); return; }
        }
        base.set(g.index, now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [capture, cfg]);

  return (
    <Group id="atajos" title={t('keys.atajos')} footer={t('keys.nota_ajustes')}>
      {conf.length > 0 && <div class="err" role="alert" style={{ margin: '8px 18px' }}>⚠ {conf.map((c) => t('keys.conflicto', { k: showKey(c.key), a: c.actions.map(actionLabel).join(' / ') })).join(' · ')}</div>}
      <Row k={t('keys.espacio_bien')} sub={t('keys.espacio_bien_sub')}><Switch label={t('keys.espacio_bien')} checked={cfg.spaceGood} onChange={(v) => save({ ...cfg, spaceGood: v })} /></Row>
      <Row k={t('keys.sonido')} sub={t('keys.sonido_sub')}><Switch label={t('keys.sonido')} checked={cfg.sound} onChange={(v) => save({ ...cfg, sound: v })} /></Row>
      <Row k={<><Gamepad2 size={16} aria-hidden="true" /> {t('keys.mando')}</>} sub={pads.length ? pads.join(' · ') : t('keys.sin_mando')} />
      {SCOPES.map((s) => (
        <>
          <h3 class="group-h">{t(`keys.scope_${s}`)}</h3>
          {ACTIONS.filter((a) => a.scope === s).map((a) => {
            const keys = keysOf(cfg, a.id), pad = padOf(cfg, a.id);
            const custom = !!cfg.keys[a.id] || !!cfg.pad[a.id];
            const busy = capture?.id === a.id;
            return (
              <div class="row-i key-row">
                <span class="k">{actionLabel(a.id)}<small>{keys.map((k) => <kbd class="kbd">{showKey(k)}</kbd>)}{pad.map((i) => <kbd class="kbd">🎮 {PAD_NAMES[i] ?? i}</kbd>)}</small></span>
                <button type="button" class="btn small" aria-pressed={busy && capture?.kind === 'key'} aria-label={t('keys.cambiar_tecla_x', { a: actionLabel(a.id) })} onClick={() => setCapture(busy && capture?.kind === 'key' ? null : { id: a.id, kind: 'key' })}><Keyboard size={14} />{' '}{busy && capture?.kind === 'key' ? t('keys.pulsa_una_tecla') : t('keys.cambiar')}</button>
                {(s === 'study' || s === 'sim') && <button type="button" class="btn small" aria-pressed={busy && capture?.kind === 'pad'} aria-label={t('keys.asignar_boton_x', { a: actionLabel(a.id) })} onClick={() => setCapture(busy && capture?.kind === 'pad' ? null : { id: a.id, kind: 'pad' })}><Gamepad2 size={14} />{' '}{busy && capture?.kind === 'pad' ? t('keys.pulsa_un_boton') : t('keys.boton')}</button>}
                {custom && <button type="button" class="btn icon small" aria-label={t('keys.restablecer_x', { a: actionLabel(a.id) })} onClick={() => { const k = { ...cfg.keys }, p = { ...cfg.pad }; delete k[a.id]; delete p[a.id]; save({ ...cfg, keys: k, pad: p }); }}><RotateCcw size={14} /></button>}
              </div>
            );
          })}
        </>
      ))}
      <div class="row-i"><button type="button" class="btn small" onClick={() => save({ ...defaultConfig(), spaceGood: cfg.spaceGood, sound: cfg.sound })}><RotateCcw size={14} />{' '}{t('keys.restablecer_todo')}</button></div>
    </Group>
  );
}
