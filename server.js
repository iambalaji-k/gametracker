import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Fetch with a timeout so a slow or hung upstream can't block the request forever
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Escape user input for use inside an IGDB query string literal
function escapeIgdbString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n;]/g, ' ');
}

// Extract STOVE member number from raw ID or profile URL
function extractStoveMemberNo(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  const urlMatch = trimmed.match(/onstove\.com\/(?:[a-z]{2,5}(?:[_-][a-z]{2,5})?\/)?(\d+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }
  const digitsMatch = trimmed.match(/^\d+$/);
  if (digitsMatch) {
    return trimmed;
  }
  const anyDigits = trimmed.match(/(\d{6,})/);
  if (anyDigits) {
    return anyDigits[1];
  }
  return trimmed;
}

// Extract and normalize Itch.io collection URL
function extractItchCollectionUrl(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  const match = trimmed.match(/(?:https?:\/\/)?(?:[a-zA-Z0-9_-]+\.)?itch\.io\/c\/(\d+)(?:\/([a-zA-Z0-9_-]+))?/i);
  if (match) {
    const colId = match[1];
    const slug = match[2] ? `/${match[2]}` : '';
    return `https://itch.io/c/${colId}${slug}`;
  }
  const simpleMatch = trimmed.match(/^c?\/??(\d+)(?:\/([a-zA-Z0-9_-]+))?$/i);
  if (simpleMatch) {
    const colId = simpleMatch[1];
    const slug = simpleMatch[2] ? `/${simpleMatch[2]}` : '';
    return `https://itch.io/c/${colId}${slug}`;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.split('?')[0].replace(/\/$/, '');
  }
  return trimmed;
}

// Self-contained SVG placeholder (the old via.placeholder.com service is defunct)
const NO_COVER_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90">' +
  '<rect width="120" height="90" fill="#1f2937"/>' +
  '<text x="50%" y="50%" fill="#9ca3af" font-family="sans-serif" font-size="12" text-anchor="middle" dominant-baseline="middle">No Cover</text>' +
  '</svg>'
);

export { app, fetchWithTimeout, escapeIgdbString, extractStoveMemberNo, extractItchCollectionUrl, decodeHtmlEntities, normalizeGameName };

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security headers + rate limiting + JSON parsing
// Note: a tailored CSP is required because the UI loads Lucide icons from a CDN,
// Google Fonts stylesheets, and external cover images. The browser no longer
// talks to Supabase directly — all DB access is proxied through /api/db/*.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        styleSrcElem: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https:", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://unpkg.com"],
      },
    },
  })
);
// CORS removed (audit B4): the frontend is served same-origin by this Express app,
// so cross-origin API access was pure liability.

// Rate limiting (audit B3): protects upstream quotas and stops this server being
// used as a free proxy. Global baseline + stricter budget for /api/* proxies.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded (30 requests/minute). Try again shortly.' }
});
app.use(globalLimiter);
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Retrieve Steam API Key from env (uppercase preferred; legacy lowercase kept as fallback)
const STEAM_API_KEY = process.env.STEAM_API_KEY || process.env.steam_web_api_key;

if (!STEAM_API_KEY) {
  console.warn('WARNING: STEAM_API_KEY is not defined in your .env file!');
}

// ---------------------------------------------------------------------------
// Server-side Supabase access (audit B1-A): credentials never leave the server.
// Uses the service key when available; falls back to the anon key. Once RLS is
// enabled in schema.sql only the service key can touch the tables.
// ---------------------------------------------------------------------------
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

function supabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function validateDbRow(row) {
  if (!row || typeof row !== 'object') return 'row must be an object';
  if (typeof row.platform !== 'string' || !row.platform.trim() || row.platform.length > 32) return 'platform must be a non-empty string (max 32 chars)';
  if ((typeof row.external_id !== 'string' && typeof row.external_id !== 'number')) return 'external_id must be a string or number';
  if (String(row.external_id).length > 64) return 'external_id too long';
  if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 256) return 'title must be a non-empty string (max 256 chars)';
  return null;
}

// Endpoint to resolve Steam custom/vanity URL to a 17-digit SteamID
app.get('/api/steam/resolve', async (req, res) => {
  const { vanityUrl } = req.query;
  if (!vanityUrl) {
    return res.status(400).json({ error: 'vanityUrl query parameter is required' });
  }

  // Audit B5: cap length and restrict charset before embedding in the upstream URL.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(vanityUrl))) {
    return res.status(400).json({ error: 'vanityUrl must be 1-64 characters (letters, digits, dashes, underscores).' });
  }

  if (!STEAM_API_KEY) {
    return res.status(500).json({ error: 'Steam API key is missing on backend server' });
  }

  try {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${STEAM_API_KEY}&vanityurl=${encodeURIComponent(vanityUrl)}`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Steam API responded with status ${response.status}`);
    }
    const data = await response.json();
    if (!data.response || data.response.success !== 1) {
      return res.status(404).json({ error: 'Steam vanity URL could not be resolved' });
    }
    return res.json(data);
  } catch (error) {
    console.error('Error resolving vanity URL:', error);
    return res.status(500).json({ error: 'Failed to resolve Steam vanity URL' });
  }
});

// Endpoint to fetch owned games for a Steam ID
app.get('/api/steam/games', async (req, res) => {
  const { steamId } = req.query;
  if (!steamId) {
    return res.status(400).json({ error: 'steamId query parameter is required' });
  }

  // Audit B5: SteamIDs are always 17 digits — reject anything else before it
  // reaches the upstream URL.
  if (!/^\d{17}$/.test(String(steamId))) {
    return res.status(400).json({ error: 'steamId must be a 17-digit SteamID (e.g. 76561198000000000).' });
  }

  if (!STEAM_API_KEY) {
    return res.status(500).json({ error: 'Steam API key is missing on backend server' });
  }

  try {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${encodeURIComponent(steamId)}&format=json&include_appinfo=true&include_played_free_games=true`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Steam API responded with status ${response.status}`);
    }
    const data = await response.json();
    if (data.response && data.response.error) {
      return res.status(404).json({ error: 'Steam ID could not be resolved' });
    }
    return res.json(data);
  } catch (error) {
    console.error('Error fetching owned games:', error);
    return res.status(500).json({ error: 'Failed to fetch Steam games' });
  }
});

// Endpoint to fetch GOG games using public profile stats
app.get('/api/gog/games', async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'username query parameter is required' });
  }

  // Audit B5: GOG usernames have a safe charset — validate before building the profile URL.
  if (!/^[A-Za-z0-9_.-]{2,40}$/.test(String(username))) {
    return res.status(400).json({ error: 'username must be 2-40 characters (letters, digits, dots, dashes, underscores).' });
  }

  try {
    let page = 1;
    let allGames = [];
    let totalPages = 1;
    const MAX_PAGES = 50;

    // Fetch all pages in a loop (bounded so a misbehaving upstream can't loop forever)
    do {
      const url = `https://www.gog.com/u/${encodeURIComponent(username)}/games/stats?page=${page}`;
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        }
      }, 10000);

      if (response.status === 404 || response.status === 403) {
        return res.status(404).json({ error: 'GOG user profile is private, does not exist, or could not be loaded.' });
      }

      if (!response.ok) {
        throw new Error(`GOG API returned status ${response.status}`);
      }

      const data = await response.json();
      totalPages = data.pages || 1;

      if (data._embedded && data._embedded.items) {
        const items = data._embedded.items;
        items.forEach(item => {
          let playtime = 0;
          if (item.stats && item.stats.playtime) {
            playtime = item.stats.playtime;
          }

          allGames.push({
            appid: item.game.id,
            name: item.game.title,
            playtime_forever: playtime,
            rtime_last_played: 0,
            cover_url: item.game.image
          });
        });
      }
      page++;
    } while (page <= totalPages && page <= MAX_PAGES);

    // Audit B8: surface truncation instead of silently dropping games
    let truncated = false;
    if (totalPages > MAX_PAGES) {
      truncated = true;
      console.warn(`[GOG] Library for "${username}" has ${totalPages} pages; only the first ${MAX_PAGES} were fetched.`);
    }

    return res.json({ games: allGames, truncated, totalAvailablePages: totalPages });
  } catch (error) {
    console.error('Error fetching GOG games:', error);
    return res.status(500).json({ error: 'Failed to fetch GOG games' });
  }
});

// Endpoint to fetch STOVE games using profile own-games API
app.get('/api/stove/games', async (req, res) => {
  const { memberNo: rawMemberNo } = req.query;
  if (!rawMemberNo) {
    return res.status(400).json({ error: 'memberNo query parameter is required' });
  }

  const memberNo = extractStoveMemberNo(rawMemberNo);
  if (!memberNo || !/^\d+$/.test(memberNo)) {
    return res.status(400).json({ error: 'Invalid STOVE Member ID or Profile URL. Expected a numeric Member No or an onstove.com profile URL.' });
  }

  try {
    let page = 1;
    let allGames = [];
    let totalPages = 1;
    const MAX_PAGES = 50;

    do {
      const url = `https://api.onstove.com/myindie/v1.1/own-games?member_no=${encodeURIComponent(memberNo)}&product_type=GAME&product_type=DLC&product_type=DEMO&product_type=UTILITY&product_type=COLLECTION&product_type=ALL&size=50&page=${page}`;
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://profile.onstove.com/',
          'Origin': 'https://profile.onstove.com',
          'X-Lang': 'EN',
          'X-Device-Type': 'pc',
          'X-Nation': 'US'
        }
      }, 10000);

      if (response.status === 404 || response.status === 403) {
        return res.status(404).json({ error: 'STOVE user profile is private, does not exist, or could not be loaded.' });
      }

      if (!response.ok) {
        throw new Error(`STOVE API returned status ${response.status}`);
      }

      const data = await response.json();
      if (data.code !== undefined && data.code !== 0 && data.code !== 200) {
        if (data.code === 90003 || data.message === 'NOT_FOUND') {
          return res.status(404).json({ error: 'STOVE user profile is private or not found.' });
        }
      }

      const value = data.value || {};
      totalPages = value.total_pages || 1;
      const content = value.content || [];

      content.forEach(item => {
        let coverUrl = null;
        if (Array.isArray(item.resources)) {
          const coverRes = item.resources.find(r => r.resource_id === 'cover.title' || r.resource_id === 'cover.background' || r.resource_id === 'cover.titleListDefault') || item.resources[0];
          if (coverRes && coverRes.data && coverRes.data.link_cdn) {
            coverUrl = coverRes.data.link_cdn;
          }
        }
        if (!coverUrl && item.page_url) {
          coverUrl = item.page_url;
        }

        const rawName = item.product_name || item.title || 'STOVE Game';
        let englishName = rawName;
        const parenMatch = rawName.match(/\(([A-Za-z0-9\s:,'!\-\.\?]+)\)/);
        if (parenMatch && parenMatch[1] && parenMatch[1].trim().length > 1) {
          englishName = parenMatch[1].trim();
        } else {
          const englishOnly = rawName.replace(/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf\uac00-\ud7af]/g, '').trim();
          if (englishOnly.length > 1) {
            englishName = englishOnly.replace(/^[\s:\-\(\)]+|[\s:\-\(\)]+$/g, '');
          }
        }

        allGames.push({
          appid: String(item.product_no || item.game_id || item.game_no),
          name: englishName,
          playtime_forever: item.play_time || 0,
          rtime_last_played: item.last_play_date ? Math.floor(new Date(item.last_play_date).getTime() / 1000) : 0,
          cover_url: coverUrl
        });
      });

      page++;
    } while (page <= totalPages && page <= MAX_PAGES);

    // Audit B8: surface truncation instead of silently dropping games
    let truncated = false;
    if (totalPages > MAX_PAGES) {
      truncated = true;
      console.warn(`[STOVE] Library for member ${memberNo} has ${totalPages} pages; only the first ${MAX_PAGES} were fetched.`);
    }

    return res.json({ memberNo, games: allGames, truncated, totalAvailablePages: totalPages });
  } catch (error) {
    console.error('Error fetching STOVE games:', error);
    return res.status(500).json({ error: 'Failed to fetch STOVE games' });
  }
});

function decodeHtmlEntities(str) {
  if (!str) return '';
  const safeCodePoint = (n) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff) ? String.fromCodePoint(n) : '';
  // Numeric forms first, named entities next, &amp; LAST so it never masks others.
  // Audit B9: numeric forms (&#39;, &#x27;, etc.) previously leaked as literal garbage.
  return str
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseItchCollectionHtml(html) {
  const games = [];
  const cellSplits = html.split(/<div[^>]*\bdata-game_id=/i);

  for (let i = 1; i < cellSplits.length; i++) {
    const chunk = cellSplits[i];
    const idMatch = chunk.match(/^["']?(\d+)["']?/);
    const gameId = idMatch ? idMatch[1] : '';

    const titleMatch = chunk.match(/class=["'][^"']*game_title[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) ||
                       chunk.match(/<a[^>]*class=["'][^"']*(?:title|game_link)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    let title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';
    title = decodeHtmlEntities(title);

    const imgMatch = chunk.match(/data-lazy_src=["']([^"']+)["']/i) ||
                     chunk.match(/src=["'](https:\/\/img\.itch\.zone\/[^"']+)["']/i);
    let coverUrl = imgMatch ? imgMatch[1] : '';

    const urlMatch = chunk.match(/class=["'][^"']*thumb_link[^"']*["'][^>]*href=["'](https?:\/\/[^"']+)["']/i) ||
                     chunk.match(/href=["'](https:\/\/[a-zA-Z0-9_-]+\.itch\.io\/[a-zA-Z0-9_-]+)["']/i);
    const gameUrl = urlMatch ? urlMatch[1] : '';

    const authorMatch = chunk.match(/class=["'][^"']*game_author[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const author = authorMatch ? decodeHtmlEntities(authorMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

    if (title && gameId) {
      games.push({
        appid: gameId,
        name: title,
        author: author,
        cover_url: coverUrl || null,
        url: gameUrl,
        playtime_forever: 0,
        rtime_last_played: 0,
        platform: 'Itch.io'
      });
    }
  }

  return games;
}

// Endpoint to fetch Itch.io collection games
app.get('/api/itch/games', async (req, res) => {
  const { collectionUrl: rawUrl } = req.query;
  if (!rawUrl) {
    return res.status(400).json({ error: 'collectionUrl query parameter is required' });
  }

  const collectionUrl = extractItchCollectionUrl(rawUrl);
  if (!collectionUrl || !collectionUrl.includes('itch.io/c/')) {
    return res.status(400).json({ error: 'Invalid Itch.io collection URL. Expected format: https://itch.io/c/12345/collection-name' });
  }

  try {
    const allGames = [];
    const cleanUrl = collectionUrl.replace(/\?.*$/, '').replace(/\/$/, '');
    const MAX_PAGES = 50;

    // Fetch initial page
    const initialRes = await fetchWithTimeout(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }, 12000);

    if (initialRes.status === 404 || initialRes.status === 403) {
      return res.status(404).json({ error: 'Itch.io collection was not found or is private.' });
    }

    if (!initialRes.ok) {
      throw new Error(`Itch.io returned status ${initialRes.status}`);
    }

    const initialHtml = await initialRes.text();
    const initialGames = parseItchCollectionHtml(initialHtml);
    for (const g of initialGames) {
      if (!allGames.some(existing => existing.appid === g.appid)) {
        allGames.push(g);
      }
    }

    // Extract collection title if present
    const titleMatch = initialHtml.match(/<div class="grid_header">\s*<h2>([^<]+)<\/h2>/i) ||
                       initialHtml.match(/<title>([^<]+)<\/title>/i);
    let collectionName = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : 'Itch.io Collection';

    // Handle pagination if collection has more pages
    let page = 2;
    while (page <= MAX_PAGES && initialHtml.includes('class="next_page"')) {
      const pageUrl = `${cleanUrl}?page=${page}`;
      const pageRes = await fetchWithTimeout(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }, 10000);

      if (!pageRes.ok) break;

      const pageHtml = await pageRes.text();
      const pageGames = parseItchCollectionHtml(pageHtml);
      let newInPage = 0;
      for (const g of pageGames) {
        if (!allGames.some(existing => existing.appid === g.appid)) {
          allGames.push(g);
          newInPage++;
        }
      }

      if (newInPage === 0 || !pageHtml.includes('class="next_page"')) {
        break;
      }
      page++;
    }

    return res.json({
      collectionUrl,
      collectionName,
      games: allGames
    });
  } catch (error) {
    console.error('Error fetching Itch.io collection:', error);
    return res.status(500).json({ error: 'Failed to fetch Itch.io collection' });
  }
});

// Twitch Access Token caching variables
let twitchAccessToken = null;
let twitchTokenExpiry = 0; // Epoch timestamp in ms
let twitchTokenPromise = null; // In-flight request dedupe

async function getTwitchAccessToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Twitch Developer credentials (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET) are not defined in .env');
  }

  const now = Date.now();
  if (twitchAccessToken && now < (twitchTokenExpiry - 60000)) {
    return twitchAccessToken;
  }

  // Reuse an already-in-flight token request so concurrent callers don't each fetch a new token
  if (twitchTokenPromise) {
    return twitchTokenPromise;
  }

  console.log('Fetching new Twitch Access Token...');
  twitchTokenPromise = (async () => {
    // Audit B10: send credentials in the POST body, not the query string
    // (secrets in URLs leak into proxy/access logs).
    const response = await fetchWithTimeout('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Twitch Auth failed: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const expiresIn = Number(data.expires_in) || 3600;
    twitchAccessToken = data.access_token;
    twitchTokenExpiry = Date.now() + (expiresIn * 1000);
    return twitchAccessToken;
  })();

  try {
    return await twitchTokenPromise;
  } finally {
    twitchTokenPromise = null;
  }
}

// Drop the cached Twitch token (audit B10: called when IGDB returns 401 so the
// next attempt fetches a fresh token instead of failing until restart).
function invalidateTwitchToken() {
  twitchAccessToken = null;
  twitchTokenExpiry = 0;
}

// Run an IGDB query with automatic token refresh + one retry on 401.
async function igdbQuery(query) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const token = await getTwitchAccessToken();

  const call = async (authToken) => fetchWithTimeout('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${authToken}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    },
    body: query
  });

  let response = await call(token);
  if (response.status === 401) {
    // Cached token revoked/expired server-side — force refresh and retry once.
    invalidateTwitchToken();
    const fresh = await getTwitchAccessToken();
    response = await call(fresh);
  }
  return response;
}

function generateSearchTerms(rawName) {
  const terms = [];
  const base = String(rawName || '')
    .replace(/[®™©]/g, '')
    .replace(/\+\s*(Campaigns|DLC|Expansion|Bonus|Extra|Pack|Edition).*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (base) terms.push(base);

  if (base.includes(':')) {
    const mainTitle = base.split(':')[0].trim();
    if (mainTitle.length >= 3 && mainTitle !== base) terms.push(mainTitle);
    const subTitle = base.split(':')[1].replace(/\d{4}-\d{4}/g, '').trim();
    if (subTitle.length >= 3 && subTitle !== base) terms.push(subTitle);
  }

  const rawClean = String(rawName || '').replace(/[®™©]/g, '').trim();
  if (rawClean && !terms.includes(rawClean)) terms.push(rawClean);

  return terms;
}

// Normalize a game name for exact-match comparison across sources (audit B7)
function normalizeGameName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// In-memory cache for /api/games/search-cover responses (audit B3).
// Key: normalized game name. TTL 5 minutes, bounded at 200 entries.
const coverSearchCache = new Map(); // key -> { expires, payload }
const COVER_CACHE_TTL_MS = 5 * 60 * 1000;
const COVER_CACHE_MAX_ENTRIES = 200;

function getCachedCoverSearch(key) {
  const entry = coverSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    coverSearchCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCachedCoverSearch(key, payload) {
  if (!coverSearchCache.has(key) && coverSearchCache.size >= COVER_CACHE_MAX_ENTRIES) {
    const oldest = coverSearchCache.keys().next().value;
    if (oldest !== undefined) coverSearchCache.delete(oldest);
  }
  coverSearchCache.set(key, { expires: Date.now() + COVER_CACHE_TTL_MS, payload });
}

// Endpoint to search Steam store catalog for a game title and resolve its AppID & vertical cover art (with IGDB fallback)
app.get('/api/games/search-cover', async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'name query parameter is required' });
  }

  // Audit B3: small in-memory cache — sync/maintenance flows repeatedly look up
  // the same game names, so this saves a lot of upstream quota.
  const cacheKey = String(name).toLowerCase().trim();
  const cached = getCachedCoverSearch(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const searchTerms = generateSearchTerms(name);

  // Audit B7: normalize names so "exact match" comparisons are robust across sources.
  const normName = normalizeGameName(name);

  try {
    let bestSteam = null; // best Steam candidate seen across all term variations

    // Score a Steam candidate: exact name match beats hero art, hero beats nothing.
    const scoreSteamCandidate = (c) => (c.exact ? 2 : 0) + (c.hasHero ? 1 : 0);

    // 1. Try Steam store search across term variations
    for (const term of searchTerms) {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.items && data.items.length > 0) {
          // Check top 3 candidates concurrently to prevent sequential timeout delays
          const topCandidates = data.items
            .slice()
            .sort((a, b) => {
              const aExact = normalizeGameName(a.name || '') === normName ? 0 : 1;
              const bExact = normalizeGameName(b.name || '') === normName ? 0 : 1;
              return aExact - bExact;
            })
            .slice(0, 3);

          const candidateResults = await Promise.all(
            topCandidates.map(async (item) => {
              const itemName = item.name || name;
              const coverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`;
              const backdropUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_hero.jpg`;

              try {
                const checkRes = await fetchWithTimeout(backdropUrl, { method: 'HEAD' }, 2500);
                if (checkRes.ok) {
                  return {
                    appid: item.id,
                    title: itemName,
                    cover_url: coverUrl,
                    backdrop_url: backdropUrl,
                    source: 'Steam',
                    exact: normalizeGameName(itemName) === normName,
                    hasHero: true
                  };
                }
              } catch (e) {
                // library_hero is missing or failed
              }

              return {
                appid: item.id,
                title: itemName,
                cover_url: coverUrl,
                backdrop_url: null,
                source: 'Steam',
                exact: normalizeGameName(itemName) === normName,
                hasHero: false
              };
            })
          );

          for (const candidate of candidateResults) {
            // Perfect score (exact name + hero art) can't be beaten — return early.
            if (candidate.exact && candidate.hasHero) {
              const winner = { appid: candidate.appid, title: candidate.title, cover_url: candidate.cover_url, backdrop_url: candidate.backdrop_url, source: candidate.source };
              setCachedCoverSearch(cacheKey, winner);
              return res.json(winner);
            }
            if (!bestSteam || scoreSteamCandidate(candidate) > scoreSteamCandidate(bestSteam)) {
              bestSteam = candidate;
            }
          }
        }
      }
    }

    // 2. Fall back to IGDB if keys are configured
    let igdbResult = null; // { appid, title, cover_url, backdrop_url, source, exact }
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (clientId && clientSecret) {
      try {
        for (const term of searchTerms) {
          const query = `search "${escapeIgdbString(term)}"; fields name, cover.url, screenshots.url, artworks.url; limit 1;`;

          const igdbRes = await igdbQuery(query);

          if (igdbRes.ok) {
            const games = await igdbRes.json();
            if (games && games.length > 0) {
              const game = games[0];
              let coverUrl = null;
              if (game.cover && game.cover.url) {
                let url = game.cover.url;
                if (url.startsWith('//')) {
                  url = 'https:' + url;
                }
                coverUrl = url.replace('t_thumb', 't_cover_big');
              }
              let backdropUrl = null;
              if (game.artworks && game.artworks.length > 0) {
                let aUrl = game.artworks[0].url;
                if (aUrl.startsWith('//')) aUrl = 'https:' + aUrl;
                backdropUrl = aUrl.replace('t_thumb', 't_1080p');
              } else if (game.screenshots && game.screenshots.length > 0) {
                let sUrl = game.screenshots[0].url;
                if (sUrl.startsWith('//')) sUrl = 'https:' + sUrl;
                backdropUrl = sUrl.replace('t_thumb', 't_1080p');
              }

              igdbResult = {
                appid: 'igdb_' + game.id,
                title: game.name,
                cover_url: coverUrl,
                backdrop_url: backdropUrl,
                source: 'IGDB',
                exact: normalizeGameName(game.name || '') === normName
              };
              break; // first term with a result wins (terms are ordered best-first)
            }
          }
        }
      } catch (err) {
        console.error('Failed to resolve cover via IGDB fallback:', err.message);
      }
    }

    // 3. Pick ONE coherent winner — identity fields and artwork always come from
    // the same source (audit B7: never glue Steam identity onto IGDB artwork).
    let winner = null;

    if (!bestSteam) {
      winner = igdbResult;
    } else if (!igdbResult) {
      winner = {
        appid: bestSteam.appid,
        title: bestSteam.title,
        cover_url: bestSteam.cover_url,
        backdrop_url: bestSteam.backdrop_url,
        source: bestSteam.source
      };
    } else {
      const steamExact = bestSteam.exact;
      const steamHasHero = bestSteam.hasHero;

      if (steamExact && steamHasHero) {
        // Steam exact + hero is the ideal result
        winner = { appid: bestSteam.appid, title: bestSteam.title, cover_url: bestSteam.cover_url, backdrop_url: bestSteam.backdrop_url, source: bestSteam.source };
      } else if (igdbResult.exact && !steamExact) {
        // IGDB matched the name exactly and Steam didn't — trust IGDB entirely
        winner = { appid: igdbResult.appid, title: igdbResult.title, cover_url: igdbResult.cover_url, backdrop_url: igdbResult.backdrop_url, source: igdbResult.source };
      } else if (steamHasHero) {
        // Neither source is an exact match, or both are — prefer Steam's real hero art
        winner = { appid: bestSteam.appid, title: bestSteam.title, cover_url: bestSteam.cover_url, backdrop_url: bestSteam.backdrop_url, source: bestSteam.source };
      } else if (igdbResult.backdrop_url) {
        // Steam had no hero, IGDB has landscape art — take IGDB wholesale
        winner = { appid: igdbResult.appid, title: igdbResult.title, cover_url: igdbResult.cover_url, backdrop_url: igdbResult.backdrop_url, source: igdbResult.source };
      } else {
        // Nothing better available — Steam candidate with null backdrop
        winner = { appid: bestSteam.appid, title: bestSteam.title, cover_url: bestSteam.cover_url, backdrop_url: null, source: bestSteam.source };
      }
    }

    const payload = winner
      ? { appid: winner.appid, title: winner.title, cover_url: winner.cover_url, backdrop_url: winner.backdrop_url, source: winner.source }
      : { appid: null, cover_url: null, backdrop_url: null };

    setCachedCoverSearch(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error('Error resolving game cover:', error);
    return res.status(500).json({ error: 'Failed to search cover art' });
  }
});

// Endpoint to search Steam store catalog for game matches (returns list of items)
app.get('/api/steam/search', async (req, res) => {
  const { term } = req.query;
  if (!term) {
    return res.status(400).json({ error: 'term query parameter is required' });
  }

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Steam storesearch returned status ${response.status}`);
    }

    const data = await response.json();
    return res.json(data.items || []);
  } catch (error) {
    console.error('Error searching Steam catalog:', error);
    return res.status(500).json({ error: 'Failed to search Steam catalog' });
  }
});

// Endpoint to search IGDB catalog for game matches (returns list of items)
app.get('/api/igdb/search', async (req, res) => {
  const { term } = req.query;
  if (!term) {
    return res.status(400).json({ error: 'term query parameter is required' });
  }

  try {
    const query = `search "${escapeIgdbString(term)}"; fields name, cover.url, screenshots.url, first_release_date, platforms.name; limit 10;`;

    // igdbQuery handles token caching + one automatic retry on a stale/revoked token
    const response = await igdbQuery(query);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`IGDB API responded with status ${response.status}: ${errText}`);
    }

    const games = await response.json();
    const formatted = games.map(game => {
      let coverUrl = null;
      let tinyImage = NO_COVER_PLACEHOLDER;
      let backdropUrl = null;

      if (game.cover && game.cover.url) {
        let url = game.cover.url;
        if (url.startsWith('//')) {
          url = 'https:' + url;
        }
        coverUrl = url.replace('t_thumb', 't_cover_big');
        tinyImage = url;
      }

      // Use the first IGDB screenshot as a landscape backdrop when available
      if (game.screenshots && game.screenshots.length > 0) {
        let sUrl = game.screenshots[0].url;
        if (sUrl.startsWith('//')) {
          sUrl = 'https:' + sUrl;
        }
        backdropUrl = sUrl.replace('t_thumb', 't_720p');
      }

      return {
        id: game.id,
        name: game.name,
        tiny_image: tinyImage,
        cover_url: coverUrl,
        backdrop_url: backdropUrl,
        platforms: game.platforms ? game.platforms.map(p => p.name) : []
      };
    });

    return res.json(formatted);
  } catch (error) {
    console.error('Error searching IGDB catalog:', error);
    return res.status(500).json({ error: 'Failed to search IGDB catalog' });
  }
});

// ---------------------------------------------------------------------------
// DB proxy endpoints (audit B1-A): the frontend talks ONLY to /api/db/*.
// Credentials stay on the server; the browser never sees the Supabase URL/key.
// ---------------------------------------------------------------------------
function requireSupabase(res) {
  if (!supabaseConfigured()) {
    res.status(503).json({ error: 'Database is not configured on this server (missing SUPABASE_URL or service key).' });
    return false;
  }
  return true;
}

async function supabaseFetch(pathWithQuery, options = {}) {
  const response = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/${pathWithQuery}`,
    { ...options, headers: { ...supabaseHeaders(), ...(options.headers || {}) } },
    15000
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Supabase responded ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

// Read all games (DB row shape)
app.get('/api/db/games', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const response = await supabaseFetch('games?select=*');
    const rows = await response.json();
    return res.json({ games: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    console.error('GET /api/db/games failed:', error.message);
    return res.status(502).json({ error: 'Failed to read games from database.' });
  }
});

// Upsert one or many games. Body: { rows: [ {platform, external_id, title, ...} ] }
app.post('/api/db/games/upsert', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Body must be { rows: [...] } with at least one game.' });
  }
  if (rows.length > 10000) {
    return res.status(400).json({ error: 'Too many rows in a single upsert (max 10000).' });
  }
  for (const row of rows) {
    const problem = validateDbRow(row);
    if (problem) {
      return res.status(400).json({ error: `Invalid row (${JSON.stringify(row.external_id ?? null)}): ${problem}` });
    }
  }
  try {
    await supabaseFetch('games?on_conflict=platform,external_id', {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    });
    return res.json({ ok: true, count: rows.length });
  } catch (error) {
    console.error('POST /api/db/games/upsert failed:', error.message);
    return res.status(502).json({ error: 'Failed to write games to database.' });
  }
});

// Delete games. Body either:
//   { matches: [ { platform, external_id } ] }              — exact rows
//   { platformLike: 'Itch.io', externalIds: ['1','2'] }     — platform ILIKE + id IN list
app.post('/api/db/games/delete', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { matches, platformLike, externalIds } = req.body || {};

  try {
    if (Array.isArray(matches) && matches.length > 0) {
      if (matches.length > 5000) return res.status(400).json({ error: 'Too many matches in one delete (max 5000).' });
      for (const m of matches) {
        if (!m || typeof m.platform !== 'string' || !m.platform.trim() || !m.external_id) {
          return res.status(400).json({ error: 'Each match needs non-empty platform and external_id.' });
        }
      }
      // PostgREST supports OR conditions: or=(and(platform.eq.A,external_id.eq.X),...)
      const clauses = matches.map(m =>
        `and(platform.eq.${encodeURIComponent(m.platform)},external_id.eq.${encodeURIComponent(String(m.external_id))})`
      );
      await supabaseFetch(`games?or=(${clauses.join(',')})`, { method: 'DELETE', headers: supabaseHeaders() });
      return res.json({ ok: true });
    }

    if (typeof platformLike === 'string' && platformLike.trim() && Array.isArray(externalIds) && externalIds.length > 0) {
      if (externalIds.length > 5000) return res.status(400).json({ error: 'Too many ids in one delete (max 5000).' });
      const inList = externalIds.map(id => `"${String(id).replace(/"/g, '')}"`).join(',');
      await supabaseFetch(
        `games?platform=ilike.${encodeURIComponent(platformLike)}&external_id=in.(${encodeURIComponent(inList)})`,
        { method: 'DELETE', headers: supabaseHeaders() }
      );
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Body must contain matches[] or platformLike+externalIds.' });
  } catch (error) {
    console.error('POST /api/db/games/delete failed:', error.message);
    return res.status(502).json({ error: 'Failed to delete from database.' });
  }
});

// Read settings row (id = 1)
app.get('/api/db/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const response = await supabaseFetch('settings?select=*&id=eq.1');
    const rows = await response.json();
    return res.json({ settings: Array.isArray(rows) && rows.length > 0 ? rows[0] : null });
  } catch (error) {
    console.error('GET /api/db/settings failed:', error.message);
    return res.status(502).json({ error: 'Failed to read settings from database.' });
  }
});

// Upsert the settings row. Body: arbitrary settings payload (id forced to 1).
app.put('/api/db/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Body must be a settings object.' });
  }
  try {
    await supabaseFetch('settings?on_conflict=id', {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ ...payload, id: 1 })
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/db/settings failed:', error.message);
    return res.status(502).json({ error: 'Failed to write settings to database.' });
  }
});

// Endpoint to query loaded configuration keys — booleans only, NEVER credentials
// (audit B1: this endpoint used to hand the Supabase URL + anon key to anyone).
app.get('/api/config/status', (req, res) => {
  res.json({
    twitchConfigured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
    steamConfigured: !!STEAM_API_KEY,
    supabaseConfigured: supabaseConfigured()
  });
});

// Fallback to index.html for SPA routing (exclude /api so API 404s stay real 404s)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.NODE_ENV !== 'test') {
  let httpServer = null;

  function startServer(portToTry, attempt = 1) {
    // Audit B10: bound the port-increment retries instead of recursing forever
    if (attempt > 10) {
      console.error(`Could not find a free port after ${attempt - 1} attempts (tried ${portToTry - attempt + 1}..${portToTry}). Giving up.`);
      process.exit(1);
    }
    const server = app.listen(portToTry, () => {
      httpServer = server;
      console.log(`==================================================`);
      console.log(`   PC Game Tracker Server Running Locally!`);
      console.log(`   URL: http://localhost:${portToTry}`);
      console.log(`==================================================`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${portToTry} is in use. Trying port ${portToTry + 1}...`);
        startServer(Number(portToTry) + 1, attempt + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  }

  // Audit B10: graceful shutdown on container/platform stop signals
  function shutdown(signal) {
    console.log(`\n${signal} received — closing server...`);
    if (!httpServer) process.exit(0);
    httpServer.close(() => {
      console.log('Server closed cleanly.');
      process.exit(0);
    });
    // Force-exit if connections refuse to drain
    setTimeout(() => {
      console.warn('Forcing exit after shutdown timeout.');
      process.exit(0);
    }, 5000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  startServer(PORT);
}

export default app;
