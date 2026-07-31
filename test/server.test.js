import { describe, it, expect, afterEach } from 'vitest';
import { escapeIgdbString, fetchWithTimeout, extractStoveMemberNo } from '../server.js';

describe('extractStoveMemberNo', () => {
  it('extracts member number from full profile URL', () => {
    const url = 'https://profile.onstove.com/en/249980712/game?types=GAME&types=DLC&types=DEMO&types=UTILITY&types=COLLECTION';
    expect(extractStoveMemberNo(url)).toBe('249980712');
  });

  it('returns raw member number if numeric string is provided', () => {
    expect(extractStoveMemberNo('249980712')).toBe('249980712');
  });

  it('handles empty or null input gracefully', () => {
    expect(extractStoveMemberNo('')).toBe('');
    expect(extractStoveMemberNo(null)).toBe('');
  });
});

describe('escapeIgdbString', () => {
  it('escapes double quotes and backslashes', () => {
    expect(escapeIgdbString('a"b\\c')).toBe('a\\"b\\\\c');
  });

  it('strips newlines and semicolons that could break the query', () => {
    expect(escapeIgdbString('a\nb;c')).toBe('a b c');
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    // restore any mocked fetch
    // @ts-ignore
    if (globalThis.__origFetch) {
      // @ts-ignore
      globalThis.fetch = globalThis.__origFetch;
      // @ts-ignore
      delete globalThis.__origFetch;
    }
  });

  it('returns the response when the upstream is fast enough', async () => {
    const original = globalThis.fetch;
    // @ts-ignore
    globalThis.__origFetch = original;
    // @ts-ignore
    globalThis.fetch = (url, opts) => Promise.resolve({ ok: true, signal: opts.signal });

    const res = await fetchWithTimeout('http://example.com', {}, 1000);
    expect(res.ok).toBe(true);
  });

  it('rejects when the upstream exceeds the timeout', async () => {
    const original = globalThis.fetch;
    // @ts-ignore
    globalThis.__origFetch = original;
    // @ts-ignore
    globalThis.fetch = (url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });

    await expect(fetchWithTimeout('http://example.com', {}, 50)).rejects.toThrow();
  });
});
