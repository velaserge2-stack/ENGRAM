/**
 * Hoja de «Compartir estadísticas» (Prompt 19 · 1). Se carga con `import()` al pulsar el botón.
 * Preparar → entregar: la imagen y su `File` se generan al abrir y al cambiar opciones (con espera
 * corta); el clic en «Compartir» solo llama a `navigator.share` dentro del gesto.
 * Nada sale del dispositivo: la hoja del sistema la abre el usuario (no hay API web para publicar
 * directo en Instagram).
 */
import { locale, t } from '../i18n';
import { Download, MapPin, RefreshCw, Share2 } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { Group, Row, Segmented, Sheet, Switch } from '../ui/kit';
import { backgroundImage, mediaUrl } from '../ui/background';
import { FRAMING_PATH, normFraming, parseFramings } from '../lib/framing';
import { readTextOr } from '../vault/util';
import { resolvedMode } from '../theme';
import { initial, type Profile } from '../lib/profile';
import type { DayAct } from '../lib/stats';
import { compose, encode, rangeLabel } from './card';
import { addPlace, clipPlace, defaultShow, fileName, fmtDuration, FORMATS, PERIODS, SHOW_KEYS, summarize, type Format, type Period, type ShowKey } from './period';

type Img = HTMLImageElement;
const loadImg = (src: string) => new Promise<Img>((res, rej) => {
  const i = new Image();
  i.decoding = 'async';
  i.onload = () => res(i);
  i.onerror = rej;
  i.src = src;
});

/** Descarga (también el «plan B» de compartir). */
function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ShareSheet(props: { act: Map<string, DayAct>; today: string; profile: Profile; onClose: () => void }) {
  const app = useApp();
  const s = app.settings;
  const sh = s.share;
  const p = props.profile;
  const def = defaultShow(p);
  const show = Object.fromEntries(SHOW_KEYS.map((k) => [k, sh.show[k] ?? def[k]])) as Record<ShowKey, boolean>;
  const set = (patch: Partial<typeof sh>) => app.update({ share: { ...sh, ...patch } });
  const sum = useMemo(() => summarize(props.act, app.col?.log ?? [], sh.period, props.today, s.timeZone, s.dayStartHour, s.streakMin), [props.act, sh.period, props.today]);
  const empty = !sum.cards && !sum.ms;
  // lugar: texto libre; se limpia al cerrar salvo «Recordar el último lugar» (apagado por defecto)
  const [place, setPlace] = useState(sh.rememberPlace ? sh.lastPlace : '');
  const shown = clipPlace(place);
  /** al usar la imagen: el lugar entra en los recientes (y se recuerda solo si así se pidió) */
  const usePlace = () => shown && set({ places: addPlace(sh.places, place), lastPlace: sh.rememberPlace ? place.trim() : '' });

  // imágenes: se decodifican una sola vez mientras la hoja está abierta y se sueltan al cerrar
  const imgs = useRef<{ bg: Img | null; avatar: Img | null; mark: Img | null; framing?: ReturnType<typeof normFraming> } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(false);
  const [tick, setTick] = useState(0);
  const job = useRef(0);

  useEffect(() => () => {
    const i = imgs.current;
    for (const m of [i?.bg, i?.avatar, i?.mark]) if (m) m.src = '';
    imgs.current = null;
  }, []);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const line = [p.program, p.institution].filter((x) => x.trim()).join(' · ') || p.motto.trim();
  const key = JSON.stringify([sh.format, sh.period, sh.show, sh.neutral, shown, s.bg, s.bgDim, s.bgBlur, s.glass, s.glassMode, sum.from, sum.to, sum.cards, sum.ms, p, tick]);
  useEffect(() => {
    const id = ++job.current; // un solo trabajo a la vez: el más reciente gana
    setBusy(true);
    setErr(false);
    const timer = setTimeout(async () => {
      try {
        if (!imgs.current) {
          const fr = s.bg.kind === 'image' ? normFraming(parseFramings(await readTextOr(app.vault, FRAMING_PATH, '{}'))[s.bg.value]) : undefined;
          const av = p.photo ? await mediaUrl(app.vault, p.photo) : null;
          imgs.current = {
            bg: await backgroundImage(s.bg, app.vault),
            avatar: av ? await loadImg(av).catch(() => null) : null,
            mark: await loadImg('./brand/logo-mark.png').catch(() => null),
            framing: fr,
          };
        }
        if (id !== job.current) return;
        await new Promise((r) => requestAnimationFrame(r));
        const i = imgs.current!;
        const font = getComputedStyle(document.documentElement);
        const r = compose({
          format: sh.format, period: sh.period, mode: resolvedMode(s), k: s.glass / 100, bg: s.bg, neutral: sh.neutral,
          framing: i.framing, dim: s.bgDim, blur: s.bgBlur, viewportW: innerWidth, bgImg: i.bg, avatar: i.avatar, mark: i.mark,
          profile: { name: p.name, username: p.username, emoji: p.emoji, initial: initial(p), line },
          show, place: shown, sum, font: `${font.getPropertyValue('--font').trim() || 'sans-serif'}, ${font.getPropertyValue('--emoji').trim() || 'sans-serif'}`,
        });
        (window as unknown as { __share: unknown }).__share = { w: r.canvas.width, h: r.canvas.height, alpha: r.alpha, contrast: r.contrast, empty: r.empty, head: r.head, lines: r.lines };
        const { blob, ext } = await encode(r.canvas);
        if (id !== job.current) return;
        setFile(new File([blob], fileName(props.today, ext), { type: blob.type }));
        setUrl(URL.createObjectURL(blob));
        setBusy(false);
      } catch (e) {
        console.error(e);
        if (id === job.current) (setErr(true), setBusy(false));
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [key]);

  const canShareFiles = !!file && 'share' in navigator && 'canShare' in navigator && navigator.canShare({ files: [file] });
  const onShare = () => {
    if (!file || empty) return;
    usePlace();
    if (!canShareFiles) {
      download(file);
      return app.toast(t('share.descargada'));
    }
    // dentro del gesto, con el File ya construido
    navigator.share({ files: [file] }).catch((e: Error) => {
      if (e.name === 'AbortError') return; // cancelar no es un error
      download(file);
      app.toast(t('share.descargada'));
    });
  };

  const nf = new Intl.NumberFormat(locale());
  const alt = [
    show.name && p.name.trim(),
    show.user && p.username && `@${p.username}`,
    shown,
    empty ? t('share.vacio') : [show.hours && `${t('share.horas_estudiadas')}: ${fmtDuration(sum.ms, locale())}`, show.cards && `${t('share.flashcards_estudiadas')}: ${nf.format(sum.cards)}`, show.streak && `${t('share.racha_dias')}: ${sum.streak}`].filter(Boolean).join(', '),
    rangeLabel(sum),
  ].filter(Boolean).join('. ');
  const FMT: Record<Format, string> = { historia: t('share.f_historia'), vertical: t('share.f_vertical'), cuadrada: t('share.f_cuadrada') };
  const PER: Record<Period, string> = { hoy: t('share.p_hoy'), '7': t('share.p_7'), '30': t('share.p_30'), anio: t('share.p_anio'), todo: t('share.p_todo') };
  const LBL: Record<ShowKey, string> = { name: t('share.s_name'), user: t('share.s_user'), photo: t('share.s_photo'), line: t('share.s_line'), hours: t('share.horas_estudiadas'), cards: t('share.flashcards_estudiadas'), streak: t('share.racha_dias'), retention: t('share.retencion'), days: t('share.dias_estudiados'), heat: t('today.mapa_de_adherencia'), brand: t('share.s_brand') };

  return (
    <Sheet title={t('share.compartir_estadisticas')} onClose={props.onClose} wide>
      <div class="share-grid">
        <div class="stack-s">
        <div class="share-prev" aria-busy={busy}>
          {url && <img src={url} alt={alt} data-format={sh.format} class={busy ? 'stale' : ''} />}
          {busy && !url && <p class="foot">{t('share.componiendo')}</p>}
          {err && (
            <div class="stack-s" role="alert">
              <p>{t('share.error')}</p>
              <button type="button" class="btn small" onClick={() => setTick(tick + 1)}><RefreshCw size={16} /> {t('share.reintentar')}</button>
            </div>
          )}
        </div>
        <div class="row wrap">
          <button type="button" class="btn primary" disabled={!file || busy || empty} onClick={onShare}><Share2 size={18} /> {t('share.compartir')}</button>
          <button type="button" class="btn" disabled={!file || busy} onClick={() => { if (!file) return; usePlace(); download(file); }}><Download size={18} /> {t('share.guardar')}</button>
        </div>
        <p class="foot">{t('share.nota_instagram')}</p>
        </div>
        <div class="stack-s">
          <Segmented label={t('share.formato')} value={sh.format} onChange={(v) => set({ format: v })} options={FORMATS.map((f) => [f, FMT[f]])} />
          <Segmented label={t('share.periodo')} value={sh.period} onChange={(v) => set({ period: v })} options={PERIODS.map((x) => [x, PER[x]])} />
          <Group title={t('share.donde_estudias')} footer={t('share.lugar_aviso')}>
            <label class="field" style={{ padding: '6px 18px' }}>
              <span class="at-input">
                <MapPin size={18} aria-hidden="true" />
                <input class="input wide" value={place} maxLength={80} placeholder={t('share.lugar_ejemplo')} aria-label={t('share.donde_estudias')} enterkeyhint="done"
                  onInput={(e) => setPlace((e.target as HTMLInputElement).value)} data-user-content />
              </span>
            </label>
            {sh.places.length > 0 && (
              <div class="row wrap" style={{ padding: '4px 18px 10px' }} role="group" aria-label={t('share.lugares_recientes')}>
                {sh.places.map((x) => <button type="button" class="btn" aria-pressed={x === place.trim()} onClick={() => setPlace(x)} data-user-content>{x}</button>)}
                <button type="button" class="btn ghost" onClick={() => set({ places: [], lastPlace: '' })}>{t('share.olvidar_lugares')}</button>
              </div>
            )}
            <Row k={t('share.recordar_lugar')}><Switch label={t('share.recordar_lugar')} checked={sh.rememberPlace} onChange={(v) => set({ rememberPlace: v, lastPlace: v ? place.trim() : '' })} /></Row>
          </Group>
          <Group title={t('share.que_mostrar')}>
            {SHOW_KEYS.filter((k) => k !== 'retention' || sum.retention !== null).map((k) => {
              // sin @usuario en el perfil: interruptor apagado y un enlace a Perfil para definirlo
              const off = k === 'user' && !p.username;
              return (
                <Row k={LBL[k]} sub={off ? <a href="#/perfil" onClick={props.onClose}>{t('share.definir_usuario')}</a> : undefined}>
                  <Switch label={LBL[k]} checked={show[k] && !off} disabled={off} onChange={(v) => set({ show: { ...sh.show, [k]: v } })} />
                </Row>
              );
            })}
            <Row k={t('share.fondo')}><Segmented label={t('share.fondo')} value={sh.neutral ? 'n' : 'a'} onChange={(v) => set({ neutral: v === 'n' })} options={[['a', t('share.fondo_app')], ['n', t('share.fondo_neutro')]]} /></Row>
          </Group>
        </div>
      </div>
    </Sheet>
  );
}
