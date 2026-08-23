# Backend Audit — `server.js`, `schema.sql`, Configs

> Full audit of the backend for the CrossPlay PC Game Tracker project.
> Severity legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low / Info

---

## ✔️ Fix Status — 2026-08-23

All selected items have been **fixed**:

| Issue | Status | Notes |
|---|---|---|
| Pre-audit `.env` cleanup | ✅ Done | `IMGHOSTING_API_KEY` + stray `grant_type` entry removed. Remaining keys (steam/Twitch/Supabase) are in use — **rotation still recommended** and can only be done by you at the providers |
| B1 DB wide open | ✅ Fixed | `/api/config/status` returns booleans only. New server-side proxy endpoints (`GET /api/db/games`, `POST /api/db/games/upsert`, `POST /api/db/games/delete`, `GET+PUT /api/db/settings`) hold credentials server-side (`SUPABASE_SERVICE_KEY` env var, falls back to anon key). Frontend refactored: zero direct Supabase calls remain; supabase-js CDN removed; CSP `connectSrc` tightened to `'self'`. `schema.sql` now **enables RLS** — ⚠️ run it in the Supabase SQL editor once to apply to the live DB |
| B2 helmet misplaced | ✅ Fixed | Moved to `dependencies` |
| B3 No rate limiting | ✅ Fixed | Global limiter (300 req/15 min) + strict `/api/*` limiter (30 req/min); 5-min TTL in-memory cache on `search-cover` (max 200 entries) |
| B4 Wide-open CORS | ✅ Fixed | `cors()` removed entirely (same-origin serving); dependency dropped |
| B5 Input validation | ✅ Fixed | steamId `/^\d{17}$/`, vanityUrl `[A-Za-z0-9_-]{1,64}`, GOG username charset, STOVE numeric post-check, itch fail-fast |
| B6 Vercel config | ✅ Fixed | `vercel.json` deleted — deploy as a normal Node process |
| B7 Cross-source mixing | ✅ Fixed | Coherent winner selection: exact-name match preferred across both sources, then hero art; identity fields and artwork always from the same source |
| B8 Silent truncation | ✅ Fixed | GOG/STOVE responses include `truncated` + `totalAvailablePages`; frontend shows a warning toast |
| B9 Regex scraper entities | ✅ Fixed | `decodeHtmlEntities` now handles numeric (`&#39;`, `&#x27;`) + `&apos;` forms, `&amp;` decoded last |
| B10 Minor issues | ✅ Partial | STEAM_API_KEY naming unified (uppercase preferred) · Twitch secret moved to POST body · 401 token invalidation + single retry via `igdbQuery()` · graceful SIGTERM/SIGINT shutdown · port-retry capped at 10. Deferred: concurrent pagination, response caching headers, boot status logging |
| B11 Thin tests | ✅ Done | New `test/routes.test.js` (supertest): credential-leak regression test, all validation 400s, DB-proxy auth requirements, decoder/normalizer helpers. Suite: 29/29 passing |

Verification: `node --check` clean · ESLint clean · Vitest 29/29 · live smoke test confirmed no credential leak + working DB proxy reads.

---

## ⚠️ Pre-audit warning: leaked secrets in `.env`

> **Update:** unused keys (`itch_api_key`, HuggingFace, Modelslab, ImgHost) and a stray
> `grant_type` line have since been removed from `.env`. The remaining keys are actively
> used by the code. Rotation of previously-shared keys is still advised.

The `.env` file contains **real, live secrets in plaintext**:

| Key | Used by this project? | Action |
|---|---|---|
| `steam_web_api_key` | ✅ Yes | **Rotate** |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | ✅ Yes | **Rotate** |
| `SUPABASE_ANON_KEY` / `SUPABASE_URL` | ✅ Yes | Rotate if DB was exposed |
| `itch_api_key` | ❌ Never read by code | **Remove** + revoke |
| `HUGGINGFACE_API_KEY` | ❌ Never read by code | **Remove** + revoke |
| `MODELSLAB_API_KEY` | ❌ Never read by code | **Remove** + revoke |
| `IMGHOSTING_API_KEY` (`sk_live_...`) | ❌ Never read by code | **Revoke immediately** — looks like a live billing key |

`.env` is correctly gitignored (verified: not committed to git), but the keys have been
shared in plaintext and half of them are dead weight. Rotate everything and strip the
unused entries.

---

## 🔴 Critical

### B1. The database is wide open to the internet ✅ FIXED (Option A: server-side proxy)

A three-part chain makes the Supabase database fully readable/writable/deletable by
**anyone** who can reach the deployed site:

1. **`GET /api/config/status` hands out the credentials to any visitor:**

   ```js
   app.get('/api/config/status', (req, res) => {
     res.json({
       twitchConfigured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
       steamConfigured: !!(process.env.steam_web_api_key || process.env.STEAM_API_KEY),
       supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
       supabaseUrl: process.env.SUPABASE_URL || null,
       supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null   // ← leaks the key
     });
   });
   ```

2. **`schema.sql` explicitly disables Row Level Security:**

   ```sql
   ALTER TABLE public.games DISABLE ROW LEVEL SECURITY;
   ALTER TABLE public.settings DISABLE ROW LEVEL SECURITY;
   ```

3. **The frontend performs direct reads/writes/deletes** with that anon key via the
   Supabase JS client (games table: select / upsert / delete; settings table: upsert).

**Impact:** anyone can `curl /api/config/status`, extract the URL + anon key, and then
`SELECT`, `INSERT`, `UPDATE`, `DELETE` every row in `games` and `settings`. The entire
library can be wiped by a stranger with no authentication.

**Fix options (pick one):**

- **Option A (recommended for a single-user app):** keep the database entirely
  server-side. Stop returning `supabaseUrl` / `supabaseAnonKey` from
  `/api/config/status` (return booleans only). Move all DB operations into backend
  endpoints that use a service key held privately in `.env`. The frontend talks only to
  `/api/...`.
- **Option B:** keep the browser-direct Supabase design, but **enable RLS** and add real
  authentication (e.g., Supabase Auth with a single allowed user) so policies can check
  `auth.uid()`. Without auth, RLS policies can't distinguish you from an attacker.
- **Minimum interim mitigation:** never echo the anon key from the API; require the user
  to paste it into the browser once (stored in `localStorage`), so the key is not
  distributed to every visitor of the site.

### B2. `helmet` is in `devDependencies` but imported by `server.js` ✅ FIXED

`package.json`:

```json
"dependencies": {
  "cors": "^2.8.5",
  "dotenv": "^16.4.5",
  "express": "^4.19.2"
},
"devDependencies": {
  "eslint": "^10.7.0",
  "helmet": "^8.3.0",     // ← wrong list
  "vitest": "^4.1.10"
}
```

`server.js` starts with `import helmet from 'helmet'`. Any production install
(`npm ci --omit=dev`, most PaaS deploys, Docker images) will **crash on boot** with
`ERR_MODULE_NOT_FOUND`. It only works locally because dev deps are installed.

**Fix:** move `helmet` to `dependencies`.

---

## 🟠 High

### B3. Zero rate limiting — the server is an open proxy ✅ FIXED

Every endpoint forwards arbitrary user input to third-party APIs with no throttle:

| Endpoint | Upstream cost per call |
|---|---|
| `GET /api/games/search-cover` | Up to N Steam storesearch calls (one per search term) × 3 concurrent HEAD requests to Steam CDN, plus IGDB queries |
| `GET /api/steam/games` / `/api/steam/resolve` | Steam Web API (key-bound quota) |
| `GET /api/gog/games` | Up to 50 sequential scrapes of gog.com |
| `GET /api/stove/games` | Up to 50 sequential calls to api.onstove.com |
| `GET /api/itch/games` | Up to 50 sequential scrapes of itch.io |
| `GET /api/igdb/search` | IGDB (Twitch-credentialed, ~4 req/sec limit) |

**Impact:** an abuser can (a) get **your** Twitch/IGDB credentials rate-limited or
banned, (b) exhaust your Steam API quota, and (c) get your server IP blocked by
GOG/itch.io for scraping.

**Fix:** add `express-rate-limit`, e.g. a global limiter (100 req/15 min/IP) plus a
stricter limiter for `/api/*` proxy routes (30 req/min/IP). Consider a small in-memory
response cache (5–10 min TTL) for `search-cover` since the same game names are looked up
repeatedly across sync/maintenance flows.

### B4. Wide-open CORS ✅ FIXED (removed)

```js
app.use(cors());
```

Allows every origin to call the proxy endpoints. Combined with B3, any third-party
website can make visitors' browsers hammer your server and your upstream quotas.

**Fix:** either remove `cors()` entirely (the frontend is served same-origin from this
same Express app), or restrict it:

```js
app.use(cors({ origin: 'https://your-deployed-domain.com' }));
```

### B5. Input validation gaps ✅ FIXED

- **`/api/steam/games`** — `steamId` is passed through completely unvalidated into the
  upstream URL. Enforce `/^\d{17}$/` and return `400` otherwise.
- **`/api/steam/resolve`** — `vanityUrl` has no length cap; cap at ~64 chars.
- **`/api/gog/games`** — GOG usernames should be validated against a safe charset
  (e.g. `/^[A-Za-z0-9_.-]{2,40}$/`) before being embedded in the profile URL.
- **`/api/stove/games`** — `extractStoveMemberNo` is lenient by design (falls back to
  returning the raw trimmed input). After extraction, verify the result is purely
  numeric before using it.
- **`/api/itch/games`** — the final `collectionUrl.includes('itch.io/c/')` check is good,
  but `extractItchCollectionUrl`'s last branch (`if (/^https?:\/\//...) return
  trimmed.split('?')[0]...`) can return arbitrary URLs that then fail the check — fine,
  but validate earlier and fail fast with a clear message.

---

## 🟡 Medium / Bugs

### B6. Vercel deployment config is broken / legacy ✅ FIXED (dropped for standard Node)

- `vercel.json` uses the **deprecated `builds` array** (`@vercel/node` +
  `@vercel/static`). Modern Vercel prefers `functions` + `rewrites` (zero-config).
- `server.js` is written as a long-lived server: `app.listen()` with recursive
  port-increment retry on `EADDRINUSE`. This is meaningless under serverless — and it
  actually **runs on Vercel**, because the guard is
  `if (process.env.NODE_ENV !== 'test')` and Vercel sets `NODE_ENV=production`.
- The SPA fallback `app.get(/^(?!\/api\/).*/, ...)` conflicts with the `routes` config
  (`/(.*) → public/$1`): static assets win, but deep links (e.g. `/settings`) behave
  differently between local and deployed environments.

**Fix:** either (a) commit to serverless — remove the `listen()` block, modernize
`vercel.json` with `rewrites`, and verify every route works as a lambda — or (b) drop
Vercel and deploy as a normal Node process (Railway/Fly/Render/VPS) where the current
code is correct.

### B7. Cover-art matching can mix two different games ✅ FIXED

In `/api/games/search-cover`:

- Any Steam candidate that has a `library_hero.jpg` **wins immediately**, even when its
  name is a worse match than another candidate or than IGDB's exact match.
- In the IGDB fallback path, the response mixes sources incoherently:

  ```js
  appid: steamCandidate ? steamCandidate.appid : ('igdb_' + game.id),
  title: steamCandidate ? steamCandidate.title : game.name,
  cover_url: (steamCandidate && steamCandidate.cover_url) ? steamCandidate.cover_url : coverUrl,
  backdrop_url: backdropUrl,   // ← from IGDB's game
  ```

  If Steam found candidate A (wrong game, no hero) and IGDB found game B, the response
  returns **A's appid/title/cover with B's backdrop** — artwork for two different games
  glued together.

**Fix:** prefer exact-name matches across both sources first; only then fall back to
fuzzy matches, and never mix identity fields from one source with artwork from another.

### B8. Silent truncation of large libraries ✅ FIXED

GOG and STOVE pagination loops are capped at `MAX_PAGES = 50` × 50 items =
**2,500 games**. Beyond that, games are silently dropped — no warning, no flag.

**Fix:** log a warning server-side and include `truncated: true` (or `totalAvailable`)
in the JSON response so the frontend can inform the user.

### B9. Fragile regex-based HTML scraping (`parseItchCollectionHtml`) ✅ Partially fixed (entity decoding; regex parser kept by choice)

- The itch.io collection scraper splits raw HTML with regexes
  (`html.split(/<div[^>]*\bdata-game_id=/i)`, nested regex matches per chunk). This will
  break the day itch.io tweaks its markup, and produces hard-to-debug partial failures.
- `decodeHtmlEntities` only handles six named entities and misses numeric forms
  (`&#39;`, `&#x27;`, `&apos;`, etc.), so titles can be stored with literal `&#039;`
  garbage.
- Scraped titles flow straight into the frontend DOM (see the frontend audit, F1) —
  scraping quality is also a security concern.

**Fix:** use `cheerio` for parsing and a proper entity decoder (or `he` npm package).

### B10. Minor backend issues ✅ Partially fixed

- **Env naming inconsistency:** `process.env.steam_web_api_key || process.env.STEAM_API_KEY`
  — two names for one key. Pick one (uppercase) and update `.env`.
- **Secret in URL:** the Twitch token request puts `client_secret` in the query string
  (`POST https://id.twitch.tv/oauth2/token?client_id=...&client_secret=...`). Secrets in
  URLs leak into proxy/access logs. Send credentials in the POST body instead.
- **Token cache never invalidated on failure:** if the cached Twitch token is revoked
  mid-life, every IGDB call 401s until server restart. On a 401 from IGDB, clear
  `twitchAccessToken` and retry once with a fresh token.
- **Sequential pagination:** GOG/STOVE/itch pages are fetched one at a time — slow for
  large libraries. Fetch pages concurrently with a bounded `Promise.all` window.
- **No graceful shutdown:** no `SIGTERM`/`SIGINT` handlers to close the server cleanly.
- **Startup warnings are inconsistent:** a loud warning exists for the missing Steam key
  only; Twitch/IGDB misconfiguration is discovered only at request time. Log all
  integration statuses at boot.
- **No caching headers** on API responses — every sync re-fetches everything upstream.
- **`startServer` recursion:** port-increment retry could in theory loop for a long
  time; bound the retries (e.g. max 10).

### B11. Tests are thin ✅ FIXED

`test/server.test.js` covers only the pure helpers (`escapeIgdbString`,
`extractStoveMemberNo`, `extractItchCollectionUrl`, `fetchWithTimeout`). Nothing
exercises routes, status codes, error paths, or the scraper. The `export { app, ... }`
at the top of `server.js` shows the intent — add `supertest` route tests with a mocked
global `fetch` to cover:

- `/api/steam/games` with a bad `steamId` → 400
- `/api/gog/games` with a 403 upstream → 404 mapping
- `/api/games/search-cover` Steam-vs-IGDB fallback precedence
- `parseItchCollectionHtml` against a saved fixture of real itch.io HTML

(Note: tests could not be executed during the audit because `node_modules` was not
installed in the checkout.)

---

## 🗄️ `schema.sql` notes

- **RLS disabled** — see B1; this is the headline database issue.
- `UNIQUE (platform, external_id)` on `games` doubles as the lookup index — ✅ no extra
  index needed.
- `settings.updated_at` has a `DEFAULT NOW()` but no auto-update trigger; the app sets
  it manually. Acceptable, but a `BEFORE UPDATE` trigger would be safer.
- Consider bounded constraints once auth exists, e.g.
  `CHECK (length(external_id) <= 64)`, `CHECK (length(title) <= 256)`.
- Migration alters at the bottom (`ADD COLUMN IF NOT EXISTS ...`) are a nice touch — ✅.

---

## ✅ Backend things done well

- `fetchWithTimeout` with `AbortController` on **every** upstream call — no hung requests.
- `escapeIgdbString` prevents IGDB query-string-literal injection; covered by tests.
- In-flight Twitch token request dedupe (`twitchTokenPromise`) prevents token-request
  storms under concurrency.
- 404/403 upstream responses mapped to friendly 404s with clear messages.
- SPA fallback regex correctly excludes `/api/*` so API 404s stay real 404s.
- Tailored Helmet CSP with documented reasoning for the CDN allowances.
- Exported app/helpers make the server testable despite the side-effectful module.

---

## 📋 Backend prioritized action list

| # | Action | Severity | Effort | Status |
|---|--------|----------|--------|--------|
| 1 | Rotate/remove all leaked keys in `.env`; delete unused ones | 🔴 | 10 min | ✅ Unused removed / ⚠️ rotation pending (user) |
| 2 | Stop echoing Supabase URL/anon key from `/api/config/status`; fix DB exposure (B1) | 🔴 | hours | ✅ Done |
| 3 | Move `helmet` to `dependencies` (B2) | 🔴 | 1 min | ✅ Done |
| 4 | Add `express-rate-limit` to `/api/*` (B3) | 🟠 | ~1 hr | ✅ Done (+ search-cover cache) |
| 5 | Restrict or remove CORS (B4) | 🟠 | 15 min | ✅ Done |
| 6 | Validate `steamId`, `vanityUrl`, `username`, `memberNo` inputs (B5) | 🟠 | ~1 hr | ✅ Done |
| 7 | Modernize or drop the Vercel config (B6) | 🟡 | ~1 hr | ✅ Dropped |
| 8 | Fix search-cover cross-source mixing (B7) | 🟡 | ~1 hr | ✅ Done |
| 9 | Replace itch scraper regexes with `cheerio` (B9) | 🟡 | ~2 hrs | ◐ Entity decoding fixed; cheerio deferred |
| 10 | Surface truncation for >2,500-game libraries (B8) | 🟡 | 30 min | ✅ Done |
| 11 | Twitch token: body credentials + 401 invalidation (B10) | 🟡 | ~1 hr | ✅ Done |
| 12 | Add supertest route tests (B11) | 🟡 | ~3 hrs | ✅ Done (19 new tests) |
