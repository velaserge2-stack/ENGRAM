import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../src/chat/providers';
import { defaultChat, defaultSettings, mergeSettings, serializeSettings } from '../src/lib/settings';
import { MODULES } from '../src/screens/addons';

describe('Asistente · configuración', () => {
  it('add-on apagado por defecto', () => expect(MODULES().find((m) => m.id === 'assistant')?.defaultOn).toBe(false));
  it('los límites por defecto son los de PROVIDERS', () => {
    expect(defaultChat().limits.gemini).toEqual(PROVIDERS.gemini.limits);
    expect(defaultChat().limits.groq).toEqual(PROVIDERS.groq.limits);
  });
  it('merge: valores válidos se conservan, basura vuelve al defecto', () => {
    const s = mergeSettings({ chat: { limits: { gemini: { rpm: 5.4, rpd: 'x' }, groq: { tpd: -3 } }, warnAt: 5 } });
    expect(s.chat.limits.gemini).toEqual({ ...PROVIDERS.gemini.limits, rpm: 5 });
    expect(s.chat.limits.groq.tpd).toBe(1);
    expect(s.chat.warnAt).toBe(0.95);
    expect(mergeSettings({}).chat).toEqual(defaultChat());
    expect(mergeSettings({ chat: 7 }).chat).toEqual(defaultChat());
  });
  it('serializa sin secretos', () => {
    const j = serializeSettings(defaultSettings());
    expect(JSON.parse(j).chat).toEqual(defaultChat());
    expect(j).not.toMatch(/apiKey|"key"|AIza|gsk_/);
  });
  it('CSP: connect-src con exactamente los dos hosts', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(readFileSync('index.html', 'utf8'))![1]!;
    expect(/connect-src ([^;]+)/.exec(csp)![1]).toBe("'self' https://generativelanguage.googleapis.com https://api.groq.com");
  });
  it.skipIf(!existsSync('dist/sw.js'))('dist: el SW no precachea chunks del SDK, y el SDK sí está en dist', () => {
    const sw = readFileSync('dist/sw.js', 'utf8');
    const sdk = readdirSync('dist/assets').filter((f) => f.endsWith('.js') && /APICallError/.test(readFileSync(`dist/assets/${f}`, 'utf8')));
    expect(sdk.length).toBeGreaterThan(0);
    for (const f of sdk) expect(sw).not.toContain(f);
  });
});
