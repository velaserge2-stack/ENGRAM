import { FolderOpen, PlusSquare, Share as ShareIcon, Smartphone } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { exampleFiles } from '../lib/example';
import { COLOR_LABEL, COLOR_NAMES } from '../lib/palette';
import { isStandalone, formatBytes, requestPersist, storageInfo } from '../lib/storage';
import { useApp, useAsync } from '../state';
import { Group, LargeTitle, Row, Segmented, Switch } from '../ui/kit';
import { FSAccessBackend } from '../vault/fsaccess';
import { rememberFolder } from '../vault/open';
import { APP_VERSION } from './backup';

export function InstallSteps() {
  return (
    <ol>
      <li>
        Toca <b>Compartir</b> <ShareIcon size={16} aria-label="(ícono de compartir)" style={{ verticalAlign: '-3px' }} /> en la barra de Safari.
      </li>
      <li>
        Elige <b>Añadir a pantalla de inicio</b> <PlusSquare size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} />.
      </li>
      <li>Abre Engrama desde su ícono: funciona sin conexión y con pantalla completa.</li>
    </ol>
  );
}

export function SettingsScreen() {
  const app = useApp();
  const s = app.settings;
  const [persistTick, setPersistTick] = useState(0);
  const { data: info } = useAsync(storageInfo, [persistTick, app.version]);
  const standalone = isStandalone();
  const ig = app.integrity;
  const days = s.lastExportAt ? Math.floor((Date.now() - s.lastExportAt) / 86_400_000) : null;

  return (
    <>
      <LargeTitle title="Ajustes" />
      <div class="page settings">
        <Group
          title="Almacenamiento"
          footer="Safari guarda tu bóveda en un espacio privado que no se ve en Archivos. Exporta regularmente para tener una copia visible."
        >
          <Row k="Dónde se guarda" sub={app.detail} />
          <Row k="Almacenamiento persistente" sub={info?.persisted ? 'Safari no debería borrar tus datos por falta de espacio.' : 'Sin garantía: el sistema podría borrarlos si falta espacio. Instalar la app ayuda.'}>
            <span class="v">{info?.persisted == null ? '—' : info.persisted ? 'Concedido' : 'No concedido'}</span>
            {!info?.persisted && (
              <button type="button" class="link" onClick={async () => (await requestPersist(), setPersistTick((n) => n + 1))}>
                Pedir
              </button>
            )}
          </Row>
          <Row k="Espacio usado">
            <span class="v">
              {formatBytes(info?.usage ?? null)} de {formatBytes(info?.quota ?? null)}
            </span>
          </Row>
          {FSAccessBackend.isSupported() && (
            <Row k="Usar una carpeta de este equipo" sub="Solo en navegadores de escritorio con acceso a carpetas. La carpeta debe estar vacía o ser una bóveda de Engrama.">
              <button
                type="button"
                class="btn small"
                onClick={async () => {
                  try {
                    const b = await FSAccessBackend.pick();
                    await rememberFolder(b.root);
                    location.reload();
                  } catch {
                    /* cancelado */
                  }
                }}
              >
                <FolderOpen size={16} aria-hidden="true" /> Elegir
              </button>
            </Row>
          )}
          {app.vault.kind === 'fsaccess' && (
            <Row k="Volver al almacenamiento privado">
              <button type="button" class="link" onClick={async () => (await rememberFolder(null), location.reload())}>
                Desconectar carpeta
              </button>
            </Row>
          )}
        </Group>

        <Group title="Respaldo">
          <Row k="Último respaldo" sub={days === null ? 'Nunca' : days === 0 ? 'Hoy' : `Hace ${days} días`}>
            <button type="button" class="btn small primary" onClick={() => app.openSheet('backup')}>
              Respaldar ahora
            </button>
          </Row>
          <Row k="Recordatorio semanal" sub="Aviso discreto en Hoy; nunca notificaciones.">
            <Switch label="Recordatorio semanal" checked={s.weeklyBackupReminder} onChange={(v) => app.update({ weeklyBackupReminder: v })} />
          </Row>
          <Row k="Avisar si pasan más de">
            <select aria-label="Días sin respaldo" value={s.backupReminderDays} onChange={(e) => app.update({ backupReminderDays: Number((e.target as HTMLSelectElement).value) })}>
              {[3, 7, 14, 30].map((d) => (
                <option value={d}>{d} días</option>
              ))}
            </select>
          </Row>
          <Row k="Importar archivos o restaurar">
            <button type="button" class="link" onClick={() => app.openSheet('import')}>
              Importar…
            </button>
          </Row>
        </Group>

        <Group title="Apariencia">
          <Row k="Tema">
            <Segmented label="Tema" value={s.theme} onChange={(v) => app.update({ theme: v })} options={[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']]} />
          </Row>
          <Row k="Tamaño de texto" sub={`${Math.round(s.textScale * 100)} %`}>
            <input type="range" aria-label="Tamaño de texto" min={0.8} max={1.6} step={0.05} value={s.textScale} onInput={(e) => app.update({ textScale: Number((e.target as HTMLInputElement).value) })} />
          </Row>
          <Row k="Intensidad del vidrio" sub={`${s.glass} %`}>
            <input type="range" aria-label="Intensidad del vidrio" min={0} max={100} step={5} value={s.glass} onInput={(e) => app.update({ glass: Number((e.target as HTMLInputElement).value) })} />
          </Row>
          <Row k="Color de acento">
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }} role="radiogroup" aria-label="Color de acento">
              {COLOR_NAMES.map((c) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={s.accent === c}
                  aria-label={COLOR_LABEL[c]}
                  onClick={() => app.update({ accent: c })}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', border: 0, background: `var(--c-${c})`, boxShadow: s.accent === c ? '0 0 0 2px var(--bg-3), 0 0 0 4px var(--c-' + c + ')' : 'none' }}
                />
              ))}
            </div>
          </Row>
        </Group>

        <Group title="Estudio">
          <Row k="El día empieza a las" sub={`Zona horaria: ${s.timeZone}`}>
            <select aria-label="Hora de inicio del día" value={s.dayStartHour} onChange={(e) => app.update({ dayStartHour: Number((e.target as HTMLSelectElement).value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </Row>
          <Row k="Tarjetas mínimas para la racha">
            <select aria-label="Tarjetas mínimas para la racha" value={s.streakMin} onChange={(e) => app.update({ streakMin: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 5, 10, 20, 50].map((n) => (
                <option value={n}>{n}</option>
              ))}
            </select>
          </Row>
        </Group>

        <Group title="Integridad" footer="Se comprueba al abrir. Engrama nunca borra ni corrige archivos por su cuenta.">
          <Row k="Archivos" sub={ig ? Object.entries(ig.byFolder).map(([k, n]) => `${k}: ${n}`).join(' · ') || 'Bóveda vacía' : 'Comprobando…'}>
            <span class="v">{ig?.files ?? '—'}</span>
          </Row>
          {ig?.problems.map((p) => <Row k={<code style={{ wordBreak: 'break-all' }}>{p.path}</code>} sub={p.reason} />)}
          <Row k={ig?.problems.length ? `${ig.problems.length} problemas` : 'Sin problemas'}>
            <button type="button" class="link" onClick={() => void app.recheckIntegrity()}>
              Comprobar de nuevo
            </button>
          </Row>
        </Group>

        <Group title="Instalar">
          {standalone ? (
            <Row k="Engrama está instalada" sub="Abierta desde la pantalla de inicio.">
              <Smartphone size={20} aria-hidden="true" />
            </Row>
          ) : (
            <div class="row-i">
              <div class="k">
                <InstallSteps />
              </div>
            </div>
          )}
        </Group>

        <Group title="Bóveda de ejemplo">
          <Row k="Cargar ejemplos" sub="Añade mazos y notas de muestra sin tocar los tuyos.">
            <button
              type="button"
              class="link"
              onClick={async () => {
                let n = 0;
                for (const f of await exampleFiles()) if (!(await app.vault.exists(f.path))) (await app.vault.write(f.path, f.text), n++);
                app.changed();
                app.toast(n ? `${n} archivos de ejemplo añadidos` : 'Los ejemplos ya estaban');
              }}
            >
              Cargar
            </button>
          </Row>
        </Group>

        <Group title="Acerca de" footer="Sin servidores, sin cuentas, sin analítica. Funciona sin conexión.">
          <Row k="Versión">
            <span class="v">{APP_VERSION}</span>
          </Row>
        </Group>
        <div style={{ height: '24px' }} />
      </div>
    </>
  );
}
