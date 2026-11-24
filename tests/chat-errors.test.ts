import { describe, expect, it } from 'vitest';
import { classify, decide, nextPacificMidnight, parseDuration, redact, techLine } from '../src/chat/errors';

const api = (statusCode: number, body = '', responseHeaders: Record<string, string> = {}) => Object.assign(new Error('x'), { statusCode, responseBody: body, responseHeaders });

describe('chat errors', () => {
  it('Gemini', () => {
    expect(classify('gemini', api(429, '{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}]}'), 0).kind).toBe('quota');
    expect(classify('gemini', api(429, '{"retryDelay":"12s","quotaId":"PerMinute"}'))).toMatchObject({ kind: 'rate', retryAfterMs: 12000 });
    expect(classify('gemini', api(400, 'API_KEY_INVALID')).kind).toBe('auth');
    expect(classify('gemini', api(403)).kind).toBe('auth');
    expect(classify('gemini', api(503)).kind).toBe('server');
  });
  it('Groq', () => {
    expect(classify('groq', api(401)).kind).toBe('auth');
    expect(classify('groq', api(429, 'Rate limit reached ... tokens per day (TPD)', { 'x-ratelimit-reset-tokens': '2m30s' }), 1000)).toMatchObject({ kind: 'quota', resetAt: 151000 });
    expect(classify('groq', api(429, 'tokens per minute', { 'Retry-After': '7' }))).toMatchObject({ kind: 'rate', retryAfterMs: 7000 });
    expect(classify('groq', api(418)).kind).toBe('other');
  });
  it('aborted, red, otro', () => {
    expect(classify('groq', Object.assign(new Error('a'), { name: 'AbortError' })).kind).toBe('aborted');
    expect(classify('groq', new TypeError('Failed to fetch')).kind).toBe('network');
    expect(classify('groq', Object.assign(new Error('c'), { cause: new TypeError('x') })).kind).toBe('network');
    expect(classify('groq', new Error('?')).kind).toBe('other');
    expect(classify('groq', null).kind).toBe('other');
  });
  it('decide', () => {
    expect([decide('quota'), decide('auth'), decide('rate'), decide('network'), decide('server'), decide('aborted'), decide('other'), decide('model'), decide('timeout')]).toEqual(['rotate', 'rotate', 'wait', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail']);
  });
  it('duraciones y medianoche del Pacífico', () => {
    expect(parseDuration('1m2.5s')).toBe(62500);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('')).toBeUndefined();
    const t = Date.UTC(2026, 0, 15, 12, 0, 0); // 04:00 PST → faltan 20 h
    expect(nextPacificMidnight(t) - t).toBe(20 * 3_600_000);
  });
  it('redact', () => {
    const k = 'AIzaSyA1234567890abcdefghijk';
    expect(redact(`bad ${k} y gsk_abcdefghij1234567890 y ?key=zzz&a=1 y Bearer abcdefghijklmnop`)).not.toMatch(/AIza|gsk_|zzz|abcdefghijklmnop/);
    expect(redact('mi clave-rara-1', ['clave-rara-1'])).not.toContain('clave-rara-1');
  });
});

describe('chat errors: detalle y modelo', () => {
  const KEY = 'AIzaSyABCDEFGHIJKLMNOPQRSTUV1234';
  const body = (o: unknown) => JSON.stringify(o);
  const tab: [string, 'gemini' | 'groq', unknown, string, number | undefined, string | undefined][] = [
    ['gemini 404', 'gemini', api(404, body({ error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-9 is not found for API version v1beta' } })), 'model', 404, 'NOT_FOUND'],
    ['gemini 400 modelo', 'gemini', api(400, body({ error: { status: 'INVALID_ARGUMENT', message: 'model is not supported for generateContent' } })), 'model', 400, 'INVALID_ARGUMENT'],
    ['groq 404', 'groq', api(404, body({ error: { message: 'The model `x` does not exist', type: 'invalid_request_error', code: 'model_not_found' } })), 'model', 404, 'model_not_found'],
    ['groq 400 retirado', 'groq', api(400, body({ error: { message: 'The model has been decommissioned', code: 'model_decommissioned' } })), 'model', 400, 'model_decommissioned'],
    ['403', 'gemini', api(403, body({ error: { status: 'PERMISSION_DENIED', message: 'location not supported' } })), 'auth', 403, 'PERMISSION_DENIED'],
    ['401', 'groq', api(401, body({ error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } })), 'auth', 401, 'invalid_api_key'],
    ['429 día', 'gemini', api(429, body({ error: { status: 'RESOURCE_EXHAUSTED', message: 'q', details: [{ quotaId: 'PerDay' }] } })), 'quota', 429, 'RESOURCE_EXHAUSTED'],
    ['429 minuto', 'groq', api(429, 'tokens per minute'), 'rate', 429, undefined],
    ['503', 'gemini', api(503, body({ error: { status: 'UNAVAILABLE', message: 'overloaded' } })), 'server', 503, 'UNAVAILABLE'],
    ['TypeError', 'groq', new TypeError('Failed to fetch'), 'network', undefined, undefined],
  ];
  for (const [name, p, e, kind, status, code] of tab) {
    it(name, () => {
      const c = classify(p, e, 0);
      expect(c.kind).toBe(kind);
      expect(c.detail?.status).toBe(status);
      expect(c.detail?.code).toBe(code);
    });
  }
  it('el 404 no rota ni invalida', () => { expect(decide('model')).toBe('fail'); expect(decide('timeout')).toBe('fail'); });
  it('la clave nunca aparece en el detalle y se trunca', () => {
    const e = Object.assign(new Error('boom ' + KEY), { statusCode: 404, responseBody: body({ error: { status: 'NOT_FOUND', message: `bad key=${KEY} x-goog-api-key: ${KEY} Bearer abcdefghijklmnop ` + 'z'.repeat(400) } }), requestBodyValues: { key: KEY }, responseHeaders: { authorization: 'Bearer ' + KEY } });
    for (const keys of [[], [KEY]]) {
      const d = classify('gemini', e, 0, keys).detail!;
      const s = JSON.stringify(d) + techLine(d);
      expect(s).not.toContain(KEY);
      expect(s).not.toContain('abcdefghijklmnop');
      expect(d.msg!.length).toBeLessThanOrEqual(200);
    }
    expect(techLine({ status: 404, code: 'NOT_FOUND', msg: 'm' })).toBe('[HTTP 404 · NOT_FOUND] m');
  });
});
