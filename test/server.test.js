import { describe, it, expect, afterEach } from 'vitest';
import { escapeIgdbString, fetchWithTimeout, extractStoveMemberNo, extractItchCollectionUrl } from '../server.js';

describe('extractItchCollectionUrl', () => {
  it('extracts collection URL from full itch.io collection links', () => {
    const url = 'https://itch.io/c/7892665/balaji-ks-collection';
    expect(extractItchCollectionUrl(url)).toBe('https://itch.io/c/7892665/balaji-ks-collection');

    const urlWithParams = 'https://itch.io/c/7892665/balaji-ks-collection?page=2&sort=date';
    expect(extractItchCollectionUrl(urlWithParams)).toBe('https://itch.io/c/7892665/balaji-ks-collection');

    const urlWithoutSlug = 'https://itch.io/c/7892665';
    expect(extractItchCollectionUrl(urlWithoutSlug)).toBe('https://itch.io/c/7892665');
  });

  it('normalizes partial collection identifiers', () => {
    expect(extractItchCollectionUrl('c/7892665/balaji-ks-collection')).toBe('https://itch.io/c/7892665/balaji-ks-collection');
    expect(extractItchCollectionUrl('7892665/balaji-ks-collection')).toBe('https://itch.io/c/7892665/balaji-ks-collection');
    expect(extractItchCollectionUrl('7892665')).toBe('https://itch.io/c/7892665');
  });

  it('handles empty or null inputs gracefully', () => {
    expect(extractItchCollectionUrl('')).toBe('');
    expect(extractItchCollectionUrl(null)).toBe('');
  });
});

describe('extractStoveMemberNo', () => {
  it('extracts member number from full profile URL with various locale formats', () => {
    const urlEn = 'https://profile.onstove.com/en/249980712/game?types=GAME&types=DLC';
    expect(extractStoveMemberNo(urlEn)).toBe('249980712');

    const urlEnUS = 'https://profile.onstove.com/en-us/249980712/game';
    expect(extractStoveMemberNo(urlEnUS)).toBe('249980712');

    const urlKr = 'https://profile.onstove.com/kr/123456789';
    expect(extractStoveMemberNo(urlKr)).toBe('123456789');

    const urlNoLang = 'https://profile.onstove.com/987654321';
    expect(extractStoveMemberNo(urlNoLang)).toBe('987654321');
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
