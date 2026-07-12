import express from 'express';
import cors from 'cors';
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

// Self-contained SVG placeholder (the old via.placeholder.com service is defunct)
const NO_COVER_PLACEHOLDER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90">' +
  '<rect width="120" height="90" fill="#1f2937"/>' +
  '<text x="50%" y="50%" fill="#9ca3af" font-family="sans-serif" font-size="12" text-anchor="middle" dominant-baseline="middle">No Cover</text>' +
  '</svg>'
);

export { app, fetchWithTimeout, escapeIgdbString };

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security headers + CORS + JSON parsing
// Note: a tailored CSP is required because the UI loads Lucide icons and the
// Supabase client from CDNs, Google Fonts stylesheets, external cover images,
// and connects directly to Supabase from the browser.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        scriptSrc: ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        styleSrcElem: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https:", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co"],
      },
    },
  })
);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Retrieve Steam API Key from env
const STEAM_API_KEY = process.env.steam_web_api_key || process.env.STEAM_API_KEY;

if (!STEAM_API_KEY) {
  console.warn('WARNING: steam_web_api_key is not defined in your .env file!');
}

// Endpoint to resolve Steam custom/vanity URL to a 17-digit SteamID
app.get('/api/steam/resolve', async (req, res) => {
  const { vanityUrl } = req.query;
  if (!vanityUrl) {
    return res.status(400).json({ error: 'vanityUrl query parameter is required' });
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

    return res.json({ games: allGames });
  } catch (error) {
    console.error('Error fetching GOG games:', error);
    return res.status(500).json({ error: 'Failed to fetch GOG games' });
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
    const response = await fetchWithTimeout(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
      method: 'POST'
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

// Endpoint to search Steam store catalog for a game title and resolve its AppID & vertical cover art (with IGDB fallback)
app.get('/api/games/search-cover', async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ error: 'name query parameter is required' });
  }

  try {
    // 1. Try Steam first
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.items && data.items.length > 0) {
        const item = data.items[0];
        const coverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`;
        return res.json({
          appid: item.id,
          title: item.name,
          cover_url: coverUrl,
          source: 'Steam'
        });
      }
    }

    // 2. Fall back to IGDB if keys are configured
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (clientId && clientSecret) {
      try {
        const token = await getTwitchAccessToken();
        const query = `search "${escapeIgdbString(name)}"; fields name, cover.url; limit 1;`;

        const igdbRes = await fetchWithTimeout('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'text/plain'
          },
          body: query
        });

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
            return res.json({
              appid: 'igdb_' + game.id,
              title: game.name,
              cover_url: coverUrl,
              source: 'IGDB'
            });
          }
        }
      } catch (err) {
        console.error('Failed to resolve cover via IGDB fallback:', err.message);
      }
    }

    return res.json({ appid: null, cover_url: null });
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
    const token = await getTwitchAccessToken();
    const clientId = process.env.TWITCH_CLIENT_ID;
    const query = `search "${escapeIgdbString(term)}"; fields name, cover.url, first_release_date, platforms.name; limit 10;`;

    const response = await fetchWithTimeout('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body: query
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`IGDB API responded with status ${response.status}: ${errText}`);
    }

    const games = await response.json();
    const formatted = games.map(game => {
      let coverUrl = null;
      let tinyImage = NO_COVER_PLACEHOLDER;

      if (game.cover && game.cover.url) {
        let url = game.cover.url;
        if (url.startsWith('//')) {
          url = 'https:' + url;
        }
        coverUrl = url.replace('t_thumb', 't_cover_big');
        tinyImage = url;
      }

      return {
        id: game.id,
        name: game.name,
        tiny_image: tinyImage,
        cover_url: coverUrl,
        platforms: game.platforms ? game.platforms.map(p => p.name) : []
      };
    });

    return res.json(formatted);
  } catch (error) {
    console.error('Error searching IGDB catalog:', error);
    return res.status(500).json({ error: 'Failed to search IGDB catalog' });
  }
});

// Endpoint to query loaded configuration keys
app.get('/api/config/status', (req, res) => {
  res.json({
    twitchConfigured: !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
    steamConfigured: !!(process.env.steam_web_api_key || process.env.STEAM_API_KEY)
  });
});

// Fallback to index.html for SPA routing (exclude /api so API 404s stay real 404s)
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`   PC Game Tracker Server Running Locally!`);
    console.log(`   URL: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}
