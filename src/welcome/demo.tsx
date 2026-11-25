import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { Ic } from './icons';

/** Marco de dispositivo con la app real en un iframe aislado (`./?demo=1`, origen opaco). */
const WIDE = '(min-width: 900px)';
const TIMEOUT = 10000;
type St = 'wait' | 'load' | 'ready' | 'fail';

export function DemoFrame(props: { hash: string; lang: string; dark: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const fr = useRef<HTMLIFrameElement>(null);
  const hashRef = useRef(props.hash);
  hashRef.current = props.hash;
  const [st, setSt] = useState<St>('wait');
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  const [s, setS] = useState(1);
  const W = wide ? 1024 : 390;
  const H = wide ? 680 : 740;
  const send = () => fr.current?.contentWindow?.postMessage({ type: 'engrama-demo:go', hash: hashRef.current }, '*');

  useEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setS(Math.min(1, Math.max(0.2, (el.clientWidth - 20) / W)));
    fit();
    if (!('ResizeObserver' in window)) { addEventListener('resize', fit); return () => removeEventListener('resize', fit); }
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  // carga al entrar en vista
  useEffect(() => {
    const el = box.current;
    if (!el || st !== 'wait') return;
    if (!('IntersectionObserver' in window)) { setSt('load'); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSt('load'); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [st]);
  // un idioma o tema nuevo recarga el demo
  const key = props.lang + (props.dark ? 'd' : 'l');
  const first = useRef(key);
  useEffect(() => {
    if (first.current !== key) { first.current = key; setSt((x) => (x === 'wait' ? x : 'load')); }
  }, [key]);
  useEffect(() => {
    if (st !== 'load') return;
    const id = setTimeout(() => setSt((x) => (x === 'load' ? 'fail' : x)), TIMEOUT);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== fr.current?.contentWindow) return;
      const d = e.data as { type?: string } | null;
      if (d?.type === 'engrama-demo:ready') { setSt('ready'); send(); }
    };
    addEventListener('message', onMsg);
    return () => { clearTimeout(id); removeEventListener('message', onMsg); };
  }, [st, key]);
  useEffect(() => { if (st === 'ready') send(); }, [props.hash]);

  const [fbT, fbS] = t('bienvenida.demo_fb').split('|');
  return (
    <div class="bv-demo" ref={box} data-state={st}>
      {st === 'fail' ? (
        <div class="bv-glass bv-fb" role="note"><span class="bv-tile"><Ic n="grex" /></span><b>{fbT}</b><p>{fbS}</p></div>
      ) : (
        <div class="bv-device bv-glass" style={{ width: `${Math.round(W * s) + 20}px` }}>
          <div class="bv-screen" style={{ width: `${Math.round(W * s)}px`, height: `${Math.round(H * s)}px` }}>
            {st !== 'wait' && (
              <iframe ref={fr} key={key} title={t('bienvenida.demo_aria')} sandbox="allow-scripts" loading="lazy"
                src={`./?demo=1&lang=${props.lang}&theme=${props.dark ? 'dark' : 'light'}`}
                width={W} height={H} style={{ width: `${W}px`, height: `${H}px`, transform: `scale(${s})` }}
                onError={() => setSt('fail')} />
            )}
            {st !== 'ready' && <div class="bv-wait" aria-live="polite">{t('bienvenida.demo_cargando')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
