import { describe, expect, it } from 'vitest';
import { classify, decide, nextPacificMidnight, parseDuration, redact } from '../src/chat/errors';

const api = (statusCode: number, body = '', responseHeaders: Record<string, string> = {}) => Object.assign(new Error('x'), { statusCode, responseBody: body, responseHeaders });

describe('chat errors', () => {
  it('Gemini', () => {
    expect(classify('gemini', api(429, '{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}]}'), 0).kind).toBe('quota');
    expect(classify('gemini', api(429, '{"retryDelay":"12s","quotaId":"PerMinute"}'))).toEqual({ kind: 'rate', retryAfterMs: 12000 });
    expect(classify('gemini', api(400, 'API_KEY_INVALID')).kind).toBe('auth');
    expect(classify('gemini', api(403)).kind).toBe('auth');
    expect(classify('gemini', api(503)).kind).toBe('server');
  });
  it('Groq', () => {
    expect(classify('groq', api(401)).kind).toBe('auth');
    expect(classify('groq', api(429, 'Rate limit reached ... tokens per day (TPD)', { 'x-ratelimit-reset-tokens': '2m30s' }), 1000)).toEqual({ kind: 'quota', resetAt: 151000 });
    expect(classify('groq', api(429, 'tokens per minute', { 'Retry-After': '7' }))).toEqual({ kind: 'rate', retryAfterMs: 7000 });
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
    expect([decide('quota'), decide('auth'), decide('rate'), decide('network'), decide('server'), decide('aborted'), decide('other')]).toEqual(['rotate', 'rotate', 'wait', 'fail', 'fail', 'fail', 'fail']);
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
