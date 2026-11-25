import { Eye, EyeOff } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { Sheet } from '../ui/kit';
import { addKey, loadKeys, MAX_KEYS, saveKeys, type KeyStore } from './keys';
import { PROVIDERS, type ProviderId } from './providers';

const IDS = Object.keys(PROVIDERS) as ProviderId[];

/** Hoja «Añadir clave» (Ajustes y Modelo y claves). La clave solo va a localStorage vía saveKeys. */
export function AddKeySheet(p: { onClose: () => void; onAdded: (s: KeyStore) => void }) {
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [alias, setAlias] = useState('');
  const [secret, setSecret] = useState('');
  const [shown, setShown] = useState(false);
  const full = loadKeys().keys.length >= MAX_KEYS;
  const add = () => {
    const n = addKey(loadKeys(), provider, alias, secret);
    if (!n || !saveKeys(n)) return;
    p.onAdded(n);
    p.onClose();
  };
  return (
    <Sheet title={t('chat.anadir')} onClose={p.onClose}>
      <form class="col" style={{ gap: '12px' }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label class="field">{t('chat.proveedor')}
          <select value={provider} disabled={full} onChange={(e) => setProvider((e.target as HTMLSelectElement).value as ProviderId)}>{IDS.map((id) => <option value={id}>{PROVIDERS[id].name}</option>)}</select>
        </label>
        <label class="field">{t('chat.alias')}
          <input class="input" value={alias} disabled={full} maxLength={30} autocomplete="off" onInput={(e) => setAlias((e.target as HTMLInputElement).value)} />
        </label>
        <div class="row" style={{ gap: '6px', alignItems: 'flex-end' }}>
          <label class="field" style={{ flex: '1 1 auto', minWidth: 0 }}>{t('chat.clave')}
            <input class="input" {...(shown ? { type: 'text' as const } : { type: 'password' as const })} value={secret} disabled={full} autocomplete="off" autocapitalize="none" spellcheck={false} autoFocus onInput={(e) => setSecret((e.target as HTMLInputElement).value)} style={{ width: '100%' }} />
          </label>
          <button type="button" class="btn icon" aria-label={shown ? t('chat.ocultar') : t('chat.mostrar')} aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
        </div>
        <small class="t3">{full ? t('chat.maximo', { n: MAX_KEYS }) : t('chat.resumen')}</small>
        <button type="submit" class="btn primary" disabled={full || !secret.trim()}>{t('chat.anadir')}</button>
      </form>
    </Sheet>
  );
}
