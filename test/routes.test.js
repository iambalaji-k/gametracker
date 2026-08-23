import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app, decodeHtmlEntities, normalizeGameName } from '../server.js';

describe('route validation & error states (backend audit B5/B11)', () => {
  describe('GET /api/config/status', () => {
    it('returns booleans only — never credentials (audit B1)', async () => {
      const res = await request(app).get('/api/config/status');
      expect(res.status).toBe(200);
      expect(typeof res.body.twitchConfigured).toBe('boolean');
      expect(typeof res.body.steamConfigured).toBe('boolean');
      expect(typeof res.body.supabaseConfigured).toBe('boolean');
      // The leak: these keys must never appear again
      expect(res.body).not.toHaveProperty('supabaseUrl');
      expect(res.body).not.toHaveProperty('supabaseAnonKey');
      const body = JSON.stringify(res.body);
      expect(body.includes('supabase.co')).toBe(false);
      expect(body.toLowerCase().includes('apikey')).toBe(false);
    });
  });

  describe('GET /api/steam/games', () => {
    it('400 when steamId is missing', async () => {
      const res = await request(app).get('/api/steam/games');
      expect(res.status).toBe(400);
    });

    it('400 when steamId is not 17 digits', async () => {
      for (const bad of ['abc', '123', '765611980000000001234', '<script>', "76561198000000'; DROP"]) {
        const res = await request(app).get(`/api/steam/games?steamId=${encodeURIComponent(bad)}`);
        expect(res.status).toBe(400);
      }
    });
  });

  describe('GET /api/steam/resolve', () => {
    it('400 when vanityUrl is missing', async () => {
      const res = await request(app).get('/api/steam/resolve');
      expect(res.status).toBe(400);
    });

    it('400 on invalid charset or excessive length', async () => {
      const res1 = await request(app).get('/api/steam/resolve?vanityUrl=' + encodeURIComponent('bad name!'));
      expect(res1.status).toBe(400);
      const res2 = await request(app).get('/api/steam/resolve?vanityUrl=' + encodeURIComponent('x'.repeat(65)));
      expect(res2.status).toBe(400);
    });

    it('accepts a well-formed vanity URL (does not fail validation)', async () => {
      // Validation passes; the request then proceeds to the Steam API path.
      // Without an API key configured the server returns 500, which proves
      // validation itself did not reject the input.
      const res = await request(app).get('/api/steam/resolve?vanityUrl=gabelogannewell');
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('GET /api/gog/games', () => {
    it('400 when username is missing', async () => {
      const res = await request(app).get('/api/gog/games');
      expect(res.status).toBe(400);
    });

    it('400 on unsafe username charset or length', async () => {
      const res1 = await request(app).get('/api/gog/games?username=' + encodeURIComponent('../etc'));
      expect(res1.status).toBe(400);
      const res2 = await request(app).get('/api/gog/games?username=' + encodeURIComponent('a'.repeat(41)));
      expect(res2.status).toBe(400);
    });

    it('accepts a well-formed username (validation only)', async () => {
      const res = await request(app).get('/api/gog/games?username=some_user-1.x');
      expect([200, 404, 500]).toContain(res.status);
    });
  });

  describe('GET /api/stove/games', () => {
    it('400 when memberNo is missing', async () => {
      const res = await request(app).get('/api/stove/games');
      expect(res.status).toBe(400);
    });

    it('400 when extracted memberNo is not purely numeric (audit B5)', async () => {
      const res = await request(app).get('/api/stove/games?memberNo=' + encodeURIComponent('garbage!!input'));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/itch/games', () => {
    it('400 when collectionUrl is missing', async () => {
      const res = await request(app).get('/api/itch/games');
      expect(res.status).toBe(400);
    });

    it('400 on a non-itch.io URL', async () => {
      const res = await request(app).get('/api/itch/games?collectionUrl=' + encodeURIComponent('https://evil.example.com/c/123'));
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/games/search-cover', () => {
    it('400 when name is missing', async () => {
      const res = await request(app).get('/api/games/search-cover');
      expect(res.status).toBe(400);
    });
  });

  describe('DB proxy endpoints require configuration', () => {
    it('POST /api/db/games/upsert returns 400 without rows', async () => {
      const res = await request(app)
        .post('/api/db/games/upsert')
        .send({ rows: [] });
      // 503 (unconfigured) would come first if Supabase isn't set up; both are acceptable,
      // but a malformed body must never be accepted.
      expect([400, 503]).toContain(res.status);
    });

    it('POST /api/db/games/delete returns 400/503 with no valid selector', async () => {
      const res = await request(app)
        .post('/api/db/games/delete')
        .send({});
      expect([400, 503]).toContain(res.status);
    });

    it('PUT /api/db/settings returns 400/503 with a non-object body', async () => {
      const res = await request(app)
        .put('/api/db/settings')
        .send([1, 2, 3]);
      expect([400, 503]).toContain(res.status);
    });
  });

  describe('helpers', () => {
    it('decodeHtmlEntities handles numeric entities (audit B9)', () => {
      expect(decodeHtmlEntities('Rocksmith&#174; Edition')).toBe('Rocksmith® Edition');
      expect(decodeHtmlEntities('Assassin&#x27;s Creed')).toBe("Assassin's Creed");
      expect(decodeHtmlEntities('It&#039;s a game')).toBe("It's a game");
      expect(decodeHtmlEntities('A &amp; B')).toBe('A & B');
      expect(decodeHtmlEntities('&apos;quoted&apos;')).toBe("'quoted'");
    });

    it('normalizeGameName normalizes across sources (audit B7)', () => {
      expect(normalizeGameName('Half-Life 2')).toBe(normalizeGameName('Half Life 2'));
      expect(normalizeGameName('The Witcher® 3')).toBe(normalizeGameName('the witcher 3'));
    });
  });
});
