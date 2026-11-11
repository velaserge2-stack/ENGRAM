/// <reference lib="webworker" />
import { searchCore } from './search-core';

const core = searchCore();
self.onmessage = (e: MessageEvent<{ id: number; op: 'reset' | 'upsert' | 'remove' | 'query'; arg: unknown; f?: unknown }>) => {
  const { id, op, arg, f } = e.data;
  try {
    const res = op === 'query' ? core.query(arg as string, f as object) : (core[op] as (a: unknown) => void)(arg);
    (self as unknown as Worker).postMessage({ id, ok: true, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
