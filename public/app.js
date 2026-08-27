// State Management
const NO_COVER_PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="%231e293b"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%2364748b" font-family="sans-serif" font-size="36">No Cover</text></svg>';

let appState = {
  games: [],
  steamId: '',
  vanityUrl: '',
  gogUsername: '',
  stoveMemberNo: '',
  itchCollectionUrl: '',
  epicConnected: false,
  legacyConnected: false,
  indiegalaConnected: false,
  filters: 'all',
  searchQuery: '',
  sortKey: 'name-asc',
  supabaseConfig: {
    enabled: false,
    url: '',
    anonKey: ''
  },
  blacklistAppIds: [],
  blacklistTitles: []
};

// Epic Games Extractor Script
const EPIC_EXTRACTOR_SCRIPT = `(async () => {
  console.log("Fetching Epic Games order history... Please wait.");
  let games = [];
  let token = "";
  let page = 1;
  
  const getCookie = (name) => {
    const value = "; " + document.cookie;
    const parts = value.split("; " + name + "=");
    if (parts.length === 2) return parts.pop().split(";").shift();
    return "";
  };

  const xsrfToken = getCookie("XSRF-AM-TOKEN");
  const headers = {
    "Accept": "application/json, text/plain, */*",
    "x-xsrf-token": xsrfToken
  };
  console.log("Attached CSRF Token:", xsrfToken);

  try {
    while (true) {
      let url = window.location.origin + "/account/v2/payment/ajaxGetOrderHistory?count=100&sortDir=DESC&sortBy=DATE&locale=en-US";
      if (token) url += \`&nextPageToken=\${token}\`;
      
      const res = await fetch(url, { headers, credentials: "include" });
      if (!res.ok) throw new Error(\`HTTP error \${res.status}\`);
      const data = await res.json();
      
      if (data.orders && data.orders.length > 0) {
        data.orders.forEach(order => {
          if (order.status === "COMPLETED" || order.orderType === "PURCHASE") {
            const orderDate = order.createdAtMillis 
              ? new Date(order.createdAtMillis).toISOString() 
              : new Date().toISOString();
              
            order.items.forEach(item => {
              games.push({
                title: item.description,
                id: item.itemId || item.description,
                date: orderDate
              });
            });
          }
        });
      }
      token = data.nextPageToken;
      if (!token) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }
    const uniqueGames = [];
    const seen = new Set();
    for (const g of games) {
      const lower = g.title.toLowerCase();
      if (lower.includes("dlc") || lower.includes("soundtrack") || lower.includes("season pass") || lower.includes("add-on") || lower.includes("content pack") || lower.includes("expansion")) {
        continue;
      }
      if (!seen.has(g.title)) {
        seen.add(g.title);
        uniqueGames.push(g);
      }
    }
    const jsonStr = JSON.stringify(uniqueGames);
    console.log("COPY THIS JSON:");
    console.log(jsonStr);
    
    try {
      await navigator.clipboard.writeText(jsonStr);
      alert("SUCCESS! " + uniqueGames.length + " games extracted and automatically copied to your clipboard! Paste it directly in CrossPlay settings.");
    } catch (e) {
      alert("SUCCESS! " + uniqueGames.length + " games extracted. Copy the JSON from your browser console (F12) and paste it in CrossPlay.");
    }
  } catch (err) {
    console.error("Error fetching order history:", err.message);
    alert("Error: " + err.message);
  }
})();`;

// Legacy Games Extractor Script
const LEGACY_EXTRACTOR_SCRIPT = `(async () => {
  console.log("Extracting Legacy Games... Please wait.");
  let games = [];
  
  const exclusions = [
    "downloads", "account", "navigation", "billing", "logout", "log out", "dashboard",
    "free games", "not a member", "become a member", "hero club", "membership",
    "no downloads", "join now", "subscribe", "sign up", "sign in", "login", "log in",
    "go shop", "you have no", "available yet", "browser", "launcher", "downloads page",
    "support", "faqs", "help", "contact", "home", "shop", "news", "games list", "games library",
    "edit profile", "address", "method", "order", "coupon", "redeem", "code", "purchased",
    "rewards club", "sign out", "signout", "rewards"
  ];
  
  const isExcluded = (el) => {
    const txt = el.textContent.trim();
    const lower = txt.toLowerCase();
    
    if (txt.length < 3 || txt.length > 80) return true;
    if (exclusions.some(word => lower.includes(word))) return true;
    
    // Check DOM hierarchy to avoid navigation menus, table headers, sidebars, headers, footers
    if (el.closest('.woocommerce-MyAccount-navigation, nav, .sidebar, aside, footer, header, thead, th')) {
      return true;
    }
    
    return false;
  };

  // 1. Scan all tables for game listings (e.g. Product, Game Name, Order Date, Order ID)
  const tables = document.querySelectorAll('table');
  tables.forEach(table => {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return;
    
    let gameIdx = -1;
    let dateIdx = -1;
    let idIdx = -1;
    
    // Scan headers to locate columns dynamically
    const firstRowHeaders = rows[0].querySelectorAll('th, td');
    firstRowHeaders.forEach((cell, idx) => {
      const txt = cell.textContent.trim().toLowerCase();
      if (txt.includes('game name') || txt === 'game') {
        gameIdx = idx;
      } else if (txt.includes('product')) {
        if (gameIdx === -1) {
          gameIdx = idx;
        }
      } else if (txt.includes('order date') || txt.includes('date')) {
        dateIdx = idx;
      } else if (txt.includes('order id') || txt.includes('id')) {
        idIdx = idx;
      }
    });
    
    // Fallback indices if header names aren't explicit
    if (gameIdx === -1) {
      const isHeader = Array.from(firstRowHeaders).some(c => c.tagName === 'TH');
      if (!isHeader && firstRowHeaders.length >= 2) {
        gameIdx = 0;
        dateIdx = 2;
        idIdx = 3;
      }
    }
    
    // Iterate rows
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td');
      if (cells.length === 0) continue;
      
      const gIdx = gameIdx !== -1 ? gameIdx : 0;
      const titleCell = cells[gIdx];
      if (!titleCell) continue;
      
      const link = titleCell.querySelector('a');
      const title = link ? link.textContent.trim() : titleCell.textContent.trim();
      
      if (title && !isExcluded(titleCell) && !games.some(g => g.title === title)) {
        const dIdx = dateIdx !== -1 ? dateIdx : (cells.length >= 3 ? 2 : -1);
        const dateStr = dIdx !== -1 && cells[dIdx] ? cells[dIdx].textContent.trim() : '';
        let dateVal = new Date(dateStr);
        if (isNaN(dateVal.getTime())) dateVal = new Date();
        
        const iIdx = idIdx !== -1 ? idIdx : (cells.length >= 4 ? 3 : -1);
        const orderId = iIdx !== -1 && cells[iIdx] ? cells[iIdx].textContent.trim() : title;
        
        games.push({
          title: title,
          id: orderId,
          date: dateVal.toISOString()
        });
      }
    }
  });

  // 2. Scan for WooCommerce downloads table links (if tables loop missed it)
  const downloadLinks = document.querySelectorAll('.woocommerce-table--order-downloads td.download-product a, td[data-title="Product"] a, td[data-title="Download"] a, .woocommerce-MyAccount-downloads td.download-product a');
  downloadLinks.forEach(el => {
    const title = el.textContent.trim();
    if (title && !isExcluded(el) && !games.some(g => g.title === title)) {
      games.push({
        title: title,
        id: title,
        date: new Date().toISOString()
      });
    }
  });

  // 3. Scan for headings (Works on /free-games/ page too)
  const headings = document.querySelectorAll('.woocommerce h3, .woocommerce h4, .entry-content h3, .entry-content h4, .entry-content p strong, .free-games-list h3, .free-games-list h4');
  headings.forEach(el => {
    const title = el.textContent.trim();
    if (title && !isExcluded(el) && !games.some(g => g.title === title)) {
      games.push({
        title: title,
        id: title,
        date: new Date().toISOString()
      });
    }
  });

  // 4. Scan for any games download links inside main content areas
  const contentArea = document.querySelector('.woocommerce, .entry-content, main');
  if (contentArea) {
    const allLinks = contentArea.querySelectorAll('a');
    allLinks.forEach(link => {
      const title = link.textContent.trim();
      const href = link.getAttribute('href') || '';
      
      const isGameLink = href.includes('/games/') || 
                         href.includes('/download/') || 
                         href.includes('legacygames.com') && !href.includes('my-account');

      if (title && isGameLink && !isExcluded(link) && !games.some(g => g.title === title)) {
        games.push({
          title: title,
          id: title,
          date: new Date().toISOString()
        });
      }
    });
  }

  // 5. Fallback list items scanner
  if (games.length === 0) {
    const listItems = document.querySelectorAll('.entry-content li, .woocommerce li');
    listItems.forEach(li => {
      const title = li.textContent.trim();
      if (title && !isExcluded(li) && !games.some(g => g.title === title)) {
        games.push({
          title: title,
          id: title,
          date: new Date().toISOString()
        });
      }
    });
  }


  const jsonStr = JSON.stringify(games);
  console.log("EXTRACTED GAMES:", jsonStr);
  
  try {
    await navigator.clipboard.writeText(jsonStr);
    alert("SUCCESS! " + games.length + " Legacy Games extracted and automatically copied to your clipboard! Paste it directly in CrossPlay settings.");
  } catch (e) {
    alert("SUCCESS! " + games.length + " Legacy Games extracted. Copy the JSON from your browser console (F12) and paste it in CrossPlay.");
  }
})();`;

// IndieGala Extractor Script
const INDIEGALA_EXTRACTOR_SCRIPT = `(async () => {
  console.log("Extracting IndieGala Games... Please wait.");
  const games = [];

  const exclusions = [
    "soundtrack", "dlc", "add-on", "content pack", "expansion", "wallpaper",
    "artbook", "ost", "season pass", "bonus content", "trailer", "teaser",
    "indiegala", "showcase", "my library", "home", "store", "giveaways", "trades"
  ];

  const isExcluded = (title) => {
    if (!title || typeof title !== 'string') return true;
    const lower = title.toLowerCase().trim();
    if (lower.length < 2 || lower.length > 120) return true;
    return exclusions.some(ex => lower === ex || lower.endsWith(\` \${ex}\`) || lower.includes(\`(\${ex})\`) || lower.includes(\`[\${ex}]\`));
  };

  const addGame = (rawTitle, rawId, dateStr, coverUrl) => {
    if (!rawTitle) return;
    const title = rawTitle.replace(/\\s+/g, ' ').trim();
    if (isExcluded(title)) return;
    if (!games.some(g => g.title.toLowerCase() === title.toLowerCase())) {
      let dateVal = dateStr ? new Date(dateStr) : new Date();
      if (isNaN(dateVal.getTime())) dateVal = new Date();
      games.push({
        title: title,
        id: rawId ? String(rawId).trim() : title,
        date: dateVal.toISOString(),
        ...(coverUrl ? { cover_url: coverUrl } : {})
      });
    }
  };

  // 1. Scan IndieGala library & showcase item card elements
  const cardSelectors = [
    '.profile-private-page-library-sub-item',
    '.profile-private-page-library-item',
    '.profile-private-page-item',
    '.profile-private-showcase-sub-item',
    '.showcase-item',
    '.my-library-item',
    '.bundle-item',
    '.lib-item',
    'div[data-game-title]'
  ];

  document.querySelectorAll(cardSelectors.join(', ')).forEach(el => {
    const titleEl = el.querySelector('.profile-private-page-library-title, .title, .game-title, .name, h3, h4, h5, [data-game-title]');
    let title = titleEl ? (titleEl.getAttribute('data-game-title') || titleEl.textContent.trim()) : '';
    if (!title && el.getAttribute('data-game-title')) {
      title = el.getAttribute('data-game-title');
    }
    const imgEl = el.querySelector('img');
    const coverUrl = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';
    const id = el.getAttribute('data-game-id') || el.getAttribute('data-id') || title;
    if (title) {
      addGame(title, id, null, coverUrl.startsWith('http') ? coverUrl : null);
    }
  });

  // 2. Scan game links and headers inside showcase / library containers
  document.querySelectorAll('.profile-private-page-library-title, a[href*="/game/"], a[href*="/store/product/"]').forEach(el => {
    const title = el.textContent.trim();
    const href = el.getAttribute('href') || '';
    if (title) {
      addGame(title, href || title, null, null);
    }
  });

  // 3. Fallback table / list scanner
  if (games.length === 0) {
    document.querySelectorAll('table tr, ul.library-list li, .library-contents div').forEach(el => {
      const strong = el.querySelector('strong, b, .game-name, .item-title');
      const title = strong ? strong.textContent.trim() : '';
      if (title) {
        addGame(title, title, null, null);
      }
    });
  }

  const jsonStr = JSON.stringify(games);
  console.log("EXTRACTED INDIEGALA GAMES (" + games.length + "):", jsonStr);

  try {
    await navigator.clipboard.writeText(jsonStr);
    alert("SUCCESS! " + games.length + " IndieGala games extracted and automatically copied to your clipboard! Paste it directly in CrossPlay settings.");
  } catch (e) {
    alert("SUCCESS! " + games.length + " IndieGala games extracted. Copy the JSON from your browser console (F12) and paste it in CrossPlay.");
  }
})();`;

// ---------------------------------------------------------------------------
// Cloud DB proxy client (backend audit B1-A): the browser never holds Supabase
// credentials — all database access goes through /api/db/* on this same server.
// ---------------------------------------------------------------------------
function isCloudEnabled() {
  return !!(appState.supabaseConfig && appState.supabaseConfig.enabled);
}

async function dbRequest(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Database request failed (${res.status})`);
  }
  return data;
}

async function dbUpsertGames(rows) {
  return dbRequest('/api/db/games/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  });
}

// matches: [{ platform, external_id }]
async function dbDeleteGames(matches) {
  return dbRequest('/api/db/games/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matches })
  });
}

// platformLike: ILIKE pattern, externalIds: string[] — used for dedupe/itch cleanup
async function dbDeleteGamesByPlatformIds(platformLike, externalIds) {
  return dbRequest('/api/db/games/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platformLike, externalIds })
  });
}

// DOM Elements
const gamesGrid = document.getElementById('games-grid');
const emptyState = document.getElementById('empty-state');
const loadingSpinner = document.getElementById('games-loading');
const loadingText = document.getElementById('loading-text');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const filterBtns = document.querySelectorAll('.tab-btn');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');

// Sync Buttons
const syncAllBtn = document.getElementById('sync-all-btn');
const syncAllIcon = document.getElementById('sync-all-icon');
const syncDropdownToggle = document.getElementById('sync-dropdown-toggle');
const syncMenu = document.getElementById('sync-menu');

// Connection Status
const connectionStatus = document.getElementById('connection-status');
const connectionText = document.getElementById('connection-text');

// Settings & Library Views
const libraryView = document.getElementById('library-view');
const settingsView = document.getElementById('settings-view');
const navLibrary = document.getElementById('nav-library');
const navSettingsBtn = document.getElementById('nav-settings-btn');
const emptyStateSettingsBtn = document.getElementById('empty-state-settings-btn');

// Steam inputs
const steamIdentifierInput = document.getElementById('steam-identifier');
const saveSteamBtn = document.getElementById('save-steam-btn');
const resolvedProfileCard = document.getElementById('resolved-profile-card');
const resolvedName = document.getElementById('resolved-name');
const resolvedId = document.getElementById('resolved-id');

// GOG inputs
const gogUsernameInput = document.getElementById('gog-username');
const saveGogBtn = document.getElementById('save-gog-btn');
const resolvedGogCard = document.getElementById('resolved-gog-card');
const resolvedGogName = document.getElementById('resolved-gog-name');
const resolvedGogId = document.getElementById('resolved-gog-id');

// STOVE inputs
const stoveMemberNoInput = document.getElementById('stove-member-no');
const saveStoveBtn = document.getElementById('save-stove-btn');
const resolvedStoveCard = document.getElementById('resolved-stove-card');
const resolvedStoveName = document.getElementById('resolved-stove-name');
const resolvedStoveId = document.getElementById('resolved-stove-id');

// Itch inputs
const itchCollectionUrlInput = document.getElementById('itch-collection-url');
const saveItchBtn = document.getElementById('save-itch-btn');
const resolvedItchCard = document.getElementById('resolved-itch-card');
const resolvedItchName = document.getElementById('resolved-itch-name');
const resolvedItchId = document.getElementById('resolved-itch-id');

// Epic inputs
const copyEpicScriptBtn = document.getElementById('copy-epic-script-btn');
const epicJsonInput = document.getElementById('epic-json-input');
const importEpicBtn = document.getElementById('import-epic-btn');
const resolvedEpicCard = document.getElementById('resolved-epic-card');

// Legacy inputs
const copyLegacyScriptBtn = document.getElementById('copy-legacy-script-btn');
const legacyJsonInput = document.getElementById('legacy-json-input');
const importLegacyBtn = document.getElementById('import-legacy-btn');
const resolvedLegacyCard = document.getElementById('resolved-legacy-card');

// IndieGala inputs
const copyIndiegalaScriptBtn = document.getElementById('copy-indiegala-script-btn');
const indiegalaJsonInput = document.getElementById('indiegala-json-input');
const importIndiegalaBtn = document.getElementById('import-indiegala-btn');
const resolvedIndiegalaCard = document.getElementById('resolved-indiegala-card');

// Add Game inputs
const addGameBtn = document.getElementById('add-game-btn');
const addGameModal = document.getElementById('add-game-modal');
const confirmModalEl = document.getElementById('confirm-modal');
const closeAddGameBtn = document.getElementById('close-add-game-btn');
const searchSourceSelect = document.getElementById('search-source-select');
const steamSearchInput = document.getElementById('steam-search-input');
const steamSearchBtn = document.getElementById('steam-search-btn');
const steamSearchResults = document.getElementById('steam-search-results');
const addGameForm = document.getElementById('add-game-form');
const manualTitleInput = document.getElementById('manual-title');
const manualPlatformInput = document.getElementById('manual-platform');
const customPlatformGroup = document.getElementById('custom-platform-group');
const manualCustomPlatformInput = document.getElementById('manual-custom-platform');
const manualCoverInput = document.getElementById('manual-cover');
const manualPlaytimeInput = document.getElementById('manual-playtime');
const manualLastPlayedInput = document.getElementById('manual-lastplayed');

// Supabase status UI selectors
const supabaseStatusAvatar = document.getElementById('supabase-status-avatar');
const supabaseStatusIcon = document.getElementById('supabase-status-icon');
const supabaseStatusText = document.getElementById('supabase-env-text');
const supabaseStatusBadge = document.getElementById('supabase-status-badge');
const resolveCoversBtn = document.getElementById('resolve-covers-btn');
const resolveGogCoversBtn = document.getElementById('resolve-gog-covers-btn');
const refreshArtworkBtn = document.getElementById('refresh-artwork-btn');
const exportBackupBtn = document.getElementById('export-backup-btn');
const importBackupBtn = document.getElementById('import-backup-btn');
const backupFileInput = document.getElementById('backup-file-input');

// Stats Elements
const statTotalGames = document.getElementById('stat-total-games');
const statTotalHours = document.getElementById('stat-total-hours');

// ---- Cinematic backdrop rotation (two-layer crossfade + Ken Burns) ----
const backdropStage = document.querySelector('.backdrop-stage');
const backdropLayers = backdropStage
  ? Array.from(backdropStage.querySelectorAll('.backdrop-layer'))
  : [];
const heroTitle = document.getElementById('hero-title');

// Tunables — display each backdrop ~8–10s, crossfade 900–1200ms.
const BACKDROP_LIFETIME = 10000; // ms a backdrop stays the focus
const BACKDROP_FADE = 1000;      // ms crossfade duration
const BACKDROP_MIN_OPACITY = 0.45;
const BACKDROP_MAX_OPACITY = 0.60;
// Luminance sampling was removed: cross-origin images taint the canvas, so
// getImageData always threw and the value silently fell back to this midpoint
// anyway (audit F6). Fixed midpoint opacity it is.
const BACKDROP_DEFAULT_OPACITY = (BACKDROP_MIN_OPACITY + BACKDROP_MAX_OPACITY) / 2;
const BACKDROP_RETRY_COOLDOWN = 20000; // ms before retrying a failed image

// Six extremely subtle Ken Burns motions. Each image picks a different one
// (never repeating the previous) and animates across its whole lifetime.
const BACKDROP_MOTIONS = [
  { name: 'zoom-in',  from: 'scale(1.03)',  to: 'scale(1.07)' },
  { name: 'zoom-out', from: 'scale(1.07)',  to: 'scale(1.03)' },
  { name: 'pan-left', from: 'translateX(16px)',  to: 'translateX(-16px)' },
  { name: 'pan-right',from: 'translateX(-16px)', to: 'translateX(16px)' },
  { name: 'pan-up',   from: 'translateY(12px)',  to: 'translateY(-12px)' },
  { name: 'pan-down', from: 'translateY(-12px)', to: 'translateY(12px)' },
];

let backdropPool = [];
let backdropPoolSignature = '';
let backdropIndex = -1;
let backdropQueue = [];       // shuffled pool indices for non-repeating random order
let backdropQueuePos = 0;
let backdropActive = 0;       // which layer (0|1) is currently visible
let backdropLastMotion = null;
let backdropTimer = null;
let backdropRunning = false;
const backdropFailureCooldown = new Map(); // url -> next-allowed timestamp
const BACKDROP_COOLDOWN_MAX_ENTRIES = 500;

// Record a backdrop load failure with retry cooldown, keeping the map bounded.
function markBackdropFailure(url) {
  if (!backdropFailureCooldown.has(url) && backdropFailureCooldown.size >= BACKDROP_COOLDOWN_MAX_ENTRIES) {
    const oldest = backdropFailureCooldown.keys().next().value;
    if (oldest !== undefined) backdropFailureCooldown.delete(oldest);
  }
  backdropFailureCooldown.set(url, Date.now() + BACKDROP_RETRY_COOLDOWN);
}

// Build the rotation pool from the synced library (backdrop > steam hero > cover).
function buildBackdropPool() {
  const pool = [];
  const seen = new Set();
  for (const g of appState.games) {
    let url = (g.backdrop_url && String(g.backdrop_url).trim()) ? g.backdrop_url : null;
    if (!url && g.platform === 'Steam' && g.appid) {
      url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_hero.jpg`;
    }
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    pool.push({ url, name: g.name || '' });
  }
  return pool;
}

// Preload an image; resolves only once fully downloaded (no fading until then).
function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('backdrop load failed: ' + url));
    img.src = url;
  });
}

// Pick a Ken Burns motion variant that never repeats back-to-back.
function pickMotion() {
  let m;
  do {
    m = BACKDROP_MOTIONS[Math.floor(Math.random() * BACKDROP_MOTIONS.length)];
  } while (m.name === backdropLastMotion && BACKDROP_MOTIONS.length > 1);
  backdropLastMotion = m.name;
  return m;
}

// Build a shuffled order of pool indices so the sequence is random but never
// repeats an image until the whole pool has been seen. The seam between two
// shuffles avoids an immediate repeat of the just-shown image.
function refillBackdropQueue() {
  const order = backdropPool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.length > 1 && backdropIndex >= 0 && order[0] === backdropIndex) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  backdropQueue = order;
  backdropQueuePos = 0;
}

// Pop the next random, non-repeating pool item (skipping URLs in failure
// cooldown). Reshuffles automatically once the queue is exhausted.
function nextBackdropItem() {
  const tryFrom = (start) => {
    for (let p = start; p < backdropQueue.length; p++) {
      const idx = backdropQueue[p];
      const candidate = backdropPool[idx];
      const cooldown = backdropFailureCooldown.get(candidate.url) || 0;
      if (Date.now() >= cooldown) {
        backdropQueuePos = p + 1;
        backdropIndex = idx;
        return candidate;
      }
    }
    return null;
  };
  let found = tryFrom(backdropQueuePos);
  if (!found) {
    refillBackdropQueue();
    found = tryFrom(0);
  }
  return found;
}

function scheduleNextBackdrop() {
  clearTimeout(backdropTimer);
  backdropTimer = setTimeout(advanceBackdrop, BACKDROP_LIFETIME);
}

// Advance to the next backdrop: preload, assign to the hidden layer, begin Ken
// Burns immediately, then crossfade. Never swaps until the next image is loaded.
async function advanceBackdrop() {
  if (backdropLayers.length < 2) return;

  if (backdropPool.length === 0) {
    backdropPool = buildBackdropPool();
    backdropPoolSignature = backdropPool.map(p => p.url).join('|');
    backdropIndex = -1;
    backdropQueue = [];
    backdropQueuePos = 0;
  }
  if (backdropPool.length === 0) {
    backdropLayers.forEach(l => l.classList.remove('is-active', 'is-animating'));
    if (heroTitle) heroTitle.textContent = '';
    return;
  }

  // Single available image: show it with a slow, endless Ken Burns. No cycling.
  if (backdropPool.length === 1) {
    const only = backdropPool[0];
    const layer = backdropLayers[0];
    const img = layer.querySelector('.backdrop-img');
    const pre = await preloadImage(only.url).catch(() => null);
    if (!pre) { scheduleNextBackdrop(); return; }
    img.src = only.url;
    img.loading = 'eager';
    img.setAttribute('fetchpriority', 'high');
    const op = BACKDROP_DEFAULT_OPACITY;
    layer.style.setProperty('--backdrop-opacity', op.toFixed(3));
    const m = pickMotion();
    layer.style.setProperty('--kb-from', m.from);
    layer.style.setProperty('--kb-to', m.to);
    layer.style.setProperty('--kb-duration', (BACKDROP_LIFETIME * 3) + 'ms');
    layer.classList.remove('is-animating');
    void layer.offsetWidth;
    layer.classList.add('is-active', 'is-animating');
    backdropLayers[1].classList.remove('is-active', 'is-animating');
    if (heroTitle) heroTitle.textContent = only.name;
    scheduleNextBackdrop();
    return;
  }

  // Pick the next random, non-repeating image (skips URLs in failure cooldown).
  const item = nextBackdropItem();
  if (!item) { scheduleNextBackdrop(); return; }

  let pre;
  try {
    pre = await preloadImage(item.url);
  } catch (e) {
    // Load failed: keep the current backdrop, retry this one later, move on.
    markBackdropFailure(item.url);
    scheduleNextBackdrop();
    return;
  }

  const incoming = backdropLayers[1 - backdropActive];
  const outgoing = backdropLayers[backdropActive];
  const img = incoming.querySelector('.backdrop-img');
  const isFirstPaint = !document.querySelector('.backdrop-layer.is-active .backdrop-img[src]') || backdropPool.length <= 2;

  // Assign artwork to the hidden layer and (re)start its Ken Burns from the top.
  img.loading = isFirstPaint ? 'eager' : 'lazy';
  if (isFirstPaint) img.setAttribute('fetchpriority', 'high');
  else img.removeAttribute('fetchpriority');
  img.src = item.url;
  const op = BACKDROP_DEFAULT_OPACITY;
  incoming.style.setProperty('--backdrop-opacity', op.toFixed(3));
  const m = pickMotion();
  incoming.style.setProperty('--kb-from', m.from);
  incoming.style.setProperty('--kb-to', m.to);
  incoming.style.setProperty('--kb-duration', BACKDROP_LIFETIME + 'ms');
  incoming.classList.remove('is-animating');
  void incoming.offsetWidth; // force reflow so the animation restarts cleanly
  incoming.classList.add('is-animating');

  // Crossfade: incoming fades in, outgoing fades out (blur/scrim stay fixed).
  incoming.classList.add('is-active');
  outgoing.classList.remove('is-active');

  // Stop animating the now-hidden layer once the crossfade settles (saves CPU).
  setTimeout(() => outgoing.classList.remove('is-animating'), BACKDROP_FADE + 60);

  backdropActive = 1 - backdropActive;
  if (heroTitle) heroTitle.textContent = item.name;

  scheduleNextBackdrop();
}

// Rebuild the pool and ensure the rotation is running. Safe to call repeatedly
// (e.g. after every library render) — the random order is only reset when the
// actual set of images changes, so filtering/sorting won't disrupt the sequence.
function updateStageBackground() {
  const newPool = buildBackdropPool();
  const sig = newPool.map(p => p.url).join('|');
  if (sig !== backdropPoolSignature) {
    backdropPool = newPool;
    backdropPoolSignature = sig;
    backdropIndex = -1;
    backdropQueue = [];
    backdropQueuePos = 0;
  }
  if (backdropPool.length === 0) {
    backdropLayers.forEach(l => l.classList.remove('is-active', 'is-animating'));
    if (heroTitle) heroTitle.textContent = '';
    return;
  }
  if (backdropRunning) return; // already cycling; next loop picks up new pool
  backdropRunning = true;
  advanceBackdrop();
}

// Pause the rotation when the tab is hidden to keep CPU/GPU idle; resume on show.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(backdropTimer);
  } else if (backdropRunning) {
    advanceBackdrop();
  }
});

let isAppPreloaderActive = true;

// Helper to smoothly dismiss the app preloader / splash screen
function hideAppPreloader(statusMsg = 'READY') {
  const preloader = document.getElementById('app-preloader');
  if (!preloader || preloader.classList.contains('is-loaded')) return;

  const statusText = document.getElementById('preloader-status-text');
  if (statusText) statusText.textContent = statusMsg;

  setTimeout(() => {
    isAppPreloaderActive = false;
    preloader.classList.add('is-loaded');
    
    // Trigger the hero stats count-up animation precisely as the loading screen fades out!
    if (typeof updateStats === 'function') {
      requestAnimationFrame(() => {
        updateStats();
      });
    }

    setTimeout(() => {
      preloader.remove();
    }, 700);
  }, 250);
}
window.hideAppPreloader = hideAppPreloader;

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  const initStartTime = performance.now();

  // Safety fallback timeout: ensure preloader dismisses even if network hangs
  const safetyTimeout = setTimeout(() => {
    hideAppPreloader('READY');
  }, 3500);

  // Load configuration and data from localStorage
  loadSettingsFromStorage();
  
  // Restore sidebar collapse state
  const isCollapsed = localStorage.getItem('crossplay_sidebar_collapsed') === 'true';
  if (isCollapsed && sidebar) {
    sidebar.classList.add('collapsed');
  }
  
  // Render Lucide icons
  lucide.createIcons();
  
  // Setup Event Listeners
  setupEventListeners();

  // Sticky top navbar that auto-hides on scroll-down, shows on scroll-up
  initStickyNav();

  const statusText = document.getElementById('preloader-status-text');
  if (statusText && appState.supabaseConfig.enabled) {
    statusText.textContent = 'CONNECTING CLOUD...';
  }
  
  // Try connecting to Supabase if configured
  await initializeSupabase();

  // Check Twitch/IGDB API credentials status
  await checkIgdbStatus();
  
  // If cloud sync is enabled (server-side Supabase), fetch settings and games from there
  if (isCloudEnabled()) {
    if (statusText) statusText.textContent = 'SYNCING VAULT...';
    await fetchSettingsFromSupabase();
    await fetchGamesFromSupabase();
  }

  // Initial render (render cards without triggering count-up before preloader dismisses)
  if (appState.games && appState.games.length > 0) {
    emptyState.classList.add('hidden');
    renderGames(false);
  } else {
    emptyState.classList.remove('hidden');
  }

  if (typeof window.updateFilterPillGlider === 'function') {
    requestAnimationFrame(() => {
      window.updateFilterPillGlider(null, true);
    });
  }

  // Wait for web fonts to be completely ready
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch (_) {}
  }

  if (typeof window.updateFilterPillGlider === 'function') {
    window.updateFilterPillGlider(null, true);
  }

  // Ensure minimum preloader display time (650ms) so the opening animation plays gracefully
  const elapsed = performance.now() - initStartTime;
  const remainingDelay = Math.max(0, 650 - elapsed);

  setTimeout(() => {
    clearTimeout(safetyTimeout);
    hideAppPreloader('READY');
  }, remainingDelay);
});

// Load settings from local storage
function loadSettingsFromStorage() {
  const savedState = localStorage.getItem('crossplay_state');
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState);
      appState.games = parsed.games || [];
      appState.steamId = parsed.steamId || '';
      appState.vanityUrl = parsed.vanityUrl || '';
      appState.gogUsername = parsed.gogUsername || '';
      appState.stoveMemberNo = parsed.stoveMemberNo || '';
      appState.epicConnected = parsed.epicConnected || false;
      appState.legacyConnected = parsed.legacyConnected || false;
      appState.supabaseConfig = parsed.supabaseConfig || { enabled: false, url: '', anonKey: '' };
      appState.blacklistAppIds = parsed.blacklistAppIds || [];
      appState.blacklistTitles = parsed.blacklistTitles || [];
      
      // Migrate old Steam-only schemas
      appState.games = appState.games.map(game => {
        if (!game.platform) {
          game.platform = 'Steam';
          game.external_id = game.appid ? String(game.appid) : '';
        }
        return game;
      });
      
      // Populate inputs with saved state
      steamIdentifierInput.value = appState.vanityUrl || appState.steamId || '';
      if (appState.steamId) {
        resolvedProfileCard.classList.remove('hidden');
        resolvedName.textContent = appState.vanityUrl ? `@${appState.vanityUrl}` : 'Steam Account';
        resolvedId.textContent = `ID: ${appState.steamId}`;
      }
      
      gogUsernameInput.value = appState.gogUsername || '';
      if (appState.gogUsername) {
        resolvedGogCard.classList.remove('hidden');
        resolvedGogName.textContent = `@${appState.gogUsername}`;
        resolvedGogId.textContent = `Username: ${appState.gogUsername}`;
      }
      
      if (stoveMemberNoInput) {
        stoveMemberNoInput.value = appState.stoveMemberNo || '';
      }
      if (appState.stoveMemberNo && resolvedStoveCard) {
        resolvedStoveCard.classList.remove('hidden');
        if (resolvedStoveName) resolvedStoveName.textContent = 'STOVE Account';
        if (resolvedStoveId) resolvedStoveId.textContent = `Member ID: ${appState.stoveMemberNo}`;
      }

      if (itchCollectionUrlInput) {
        itchCollectionUrlInput.value = appState.itchCollectionUrl || '';
      }
      if (appState.itchCollectionUrl && resolvedItchCard) {
        resolvedItchCard.classList.remove('hidden');
        if (resolvedItchName) resolvedItchName.textContent = 'Itch.io Collection';
        if (resolvedItchId) resolvedItchId.textContent = 'Collection: Connected';
      }

      if (appState.epicConnected) {
        resolvedEpicCard.classList.remove('hidden');
      }

      if (appState.legacyConnected && resolvedLegacyCard) {
        resolvedLegacyCard.classList.remove('hidden');
      }

      if (appState.indiegalaConnected && resolvedIndiegalaCard) {
        resolvedIndiegalaCard.classList.remove('hidden');
      }

      // Supabase is loaded automatically from backend now.
    } catch (e) {
      console.error('Error parsing saved settings state:', e);
    }
  }
}

// Save settings to local storage and Supabase database
async function saveSettingsToStorage() {
  const supabaseEnabled = !!(appState.supabaseConfig && appState.supabaseConfig.enabled);
  const dataToSave = {
    steamId: appState.steamId,
    vanityUrl: appState.vanityUrl,
    gogUsername: appState.gogUsername,
    stoveMemberNo: appState.stoveMemberNo,
    itchCollectionUrl: appState.itchCollectionUrl,
    epicConnected: appState.epicConnected,
    legacyConnected: appState.legacyConnected,
    indiegalaConnected: appState.indiegalaConnected,
    supabaseConfig: appState.supabaseConfig,
    blacklistAppIds: appState.blacklistAppIds,
    blacklistTitles: appState.blacklistTitles
  };

  // With cloud sync enabled the games live in Supabase — persisting the whole
  // library locally would blow the ~5MB localStorage quota and silently lose
  // edits (audit F8). Only keep the games array for the no-cloud mode.
  if (!supabaseEnabled) {
    dataToSave.games = appState.games;
  }
  
  try {
    localStorage.setItem('crossplay_state', JSON.stringify(dataToSave));
  } catch (e) {
    console.error('Failed to write crossplay_state to localStorage:', e);
  }

  // Sync to Supabase settings table (via backend proxy) if connected
  if (supabaseEnabled) {
    try {
      await dbRequest('/api/db/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steam_id: appState.steamId,
          vanity_url: appState.vanityUrl,
          gog_username: appState.gogUsername,
          stove_member_no: appState.stoveMemberNo,
          itch_collection_url: appState.itchCollectionUrl,
          epic_connected: appState.epicConnected,
          legacy_connected: appState.legacyConnected,
          indiegala_connected: appState.indiegalaConnected,
          blacklist_app_ids: appState.blacklistAppIds,
          blacklist_titles: appState.blacklistTitles,
          updated_at: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error('Failed to sync settings to Supabase:', err);
      if (err.message && err.message.includes('itch_collection_url')) {
        showToast('Please run the migration SQL in Supabase SQL editor to add the itch_collection_url column.', 'warning');
      }
    }
  }
}

// Helper to extract STOVE member number from raw ID or profile URL
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

// Helper to extract Itch.io collection URL from raw input
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

// Normalize game title for robust duplicate matching
function normalizeGameTitle(title) {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&/g, 'and')
    .replace(/\b(part|episode|case|chapter|vol|volume)\s+(one|i)\b/g, '$1 1')
    .replace(/\b(part|episode|case|chapter|vol|volume)\s+(two|ii)\b/g, '$1 2')
    .replace(/\b(part|episode|case|chapter|vol|volume)\s+(three|iii)\b/g, '$1 3')
    .replace(/\b(part|episode|case|chapter|vol|volume)\s+(four|iv)\b/g, '$1 4')
    .replace(/\b(part|episode|case|chapter|vol|volume)\s+(five|v)\b/g, '$1 5')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper to stem plural words for title matching (e.g. Lords of Chaos -> Lord of Chaos)
function stemTitle(title) {
  if (!title) return '';
  return normalizeGameTitle(title)
    .split(' ')
    .map(w => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w)
    .join(' ');
}

// Deduplicate a list of games by platform and normalized title
function deduplicateGamesList(gamesList, autoCleanSupabase = false) {
  if (!Array.isArray(gamesList)) return [];

  const uniqueMap = new Map();
  const duplicateExternalIdsByPlatform = new Map();

  for (const game of gamesList) {
    if (!game) continue;
    const platform = (game.platform || 'Other').trim();
    const rawTitle = game.name || game.title || '';
    const stem = stemTitle(rawTitle);
    
    // Key by normalized platform and stemmed title
    const key = `${platform.toLowerCase()}:::${stem}`;

    if (!stem) {
      const idKey = `${platform.toLowerCase()}:::id:::${game.external_id || Math.random()}`;
      uniqueMap.set(idKey, game);
      continue;
    }

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { ...game });
    } else {
      const existing = uniqueMap.get(key);

      const existingIsManual = String(existing.external_id || '').startsWith('manual_');
      const currentIsManual = String(game.external_id || '').startsWith('manual_');

      let winner = existing;
      let loser = game;

      // Prefer non-manual (official store ID) over manual_...
      if (existingIsManual && !currentIsManual) {
        winner = { ...game };
        loser = existing;
      }

      // Merge cover and backdrop if winner is missing them
      if (!winner.cover_url && loser.cover_url) winner.cover_url = loser.cover_url;
      if (!winner.backdrop_url && loser.backdrop_url) winner.backdrop_url = loser.backdrop_url;

      // Merge playtime (keep largest)
      const winnerPlaytime = winner.playtime_forever || 0;
      const loserPlaytime = loser.playtime_forever || 0;
      winner.playtime_forever = Math.max(winnerPlaytime, loserPlaytime);

      // Merge last played (keep most recent)
      const winnerLastPlayed = winner.rtime_last_played || 0;
      const loserLastPlayed = loser.rtime_last_played || 0;
      winner.rtime_last_played = Math.max(winnerLastPlayed, loserLastPlayed);

      uniqueMap.set(key, winner);

      // Record loser external_id for database cleanup
      if (loser.external_id && String(loser.external_id) !== String(winner.external_id)) {
        const platKey = loser.platform || platform;
        if (!duplicateExternalIdsByPlatform.has(platKey)) {
          duplicateExternalIdsByPlatform.set(platKey, new Set());
        }
        duplicateExternalIdsByPlatform.get(platKey).add(String(loser.external_id));
      }
    }
  }

  // If requested and supabase is connected, delete duplicate rows in the background
  if (autoCleanSupabase && isCloudEnabled() && duplicateExternalIdsByPlatform.size > 0) {
    for (const [plat, idSet] of duplicateExternalIdsByPlatform.entries()) {
      const ids = Array.from(idSet);
      if (ids.length > 0) {
        console.log(`[CrossPlay] Cleaning up ${ids.length} duplicate entries for ${plat} in Supabase:`, ids);
        dbDeleteGamesByPlatformIds(plat, ids)
          .then(() => console.log(`[CrossPlay] Cleaned up duplicate rows for ${plat} from Supabase.`))
          .catch((err) => console.warn('[CrossPlay] Failed to remove duplicate rows from Supabase:', err));
      }
    }
  }

  return Array.from(uniqueMap.values());
}

// ---------------------------------------------------------------------------
// Security & data-integrity helpers (docs/frontend-audit.md F1 / F2 / F3.3)
// ---------------------------------------------------------------------------

// Escape a value for safe interpolation into HTML text/attribute contexts.
// ALWAYS use this when injecting game names, URLs, or error messages into
// innerHTML templates — that data comes from scraped third-party pages,
// pasted JSON, imported backups, and the database.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only http(s) artwork URLs are allowed (blocks javascript:, data:, etc.).
function isValidHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Returns a URL safe for src="..." usage, or '' if it is not a valid http(s) URL.
function safeArtUrl(url) {
  return isValidHttpUrl(url) ? url.trim() : '';
}

// Strip control characters and cap length.
function cleanTextField(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

// Validate/coerce one game object coming from an untrusted source
// (backup file, pasted extractor JSON). Returns a sanitized copy,
// or null if the entry is unusable. See audit F2.
function sanitizeGame(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  let externalId = raw.external_id;
  if (typeof externalId === 'number' && Number.isFinite(externalId)) externalId = String(externalId);
  if (typeof externalId !== 'string') return null;
  externalId = externalId.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 64);
  if (!externalId) return null;

  const name = cleanTextField(raw.name ?? raw.title, 256);
  if (!name) return null;

  const playtime = Number(raw.playtime_forever);
  const lastPlayed = Number(raw.rtime_last_played);

  return {
    ...raw,
    external_id: externalId.trim(),
    platform: cleanTextField(raw.platform, 32) || 'Legacy',
    appid: (typeof raw.appid === 'string' || typeof raw.appid === 'number') ? raw.appid : '',
    name,
    playtime_forever: Number.isFinite(playtime) && playtime >= 0 ? Math.floor(playtime) : 0,
    rtime_last_played: Number.isInteger(lastPlayed) && lastPlayed >= 0 ? lastPlayed : 0,
    cover_url: isValidHttpUrl(raw.cover_url) ? raw.cover_url.trim() : null,
    backdrop_url: isValidHttpUrl(raw.backdrop_url) ? raw.backdrop_url.trim() : null
  };
}

// Single source of truth for the Supabase `games` row shape (audit F3.3).
// Every cloud write must go through this so fields can never drift apart.
function toDbRow(game) {
  return {
    external_id: String(game.external_id),
    platform: game.platform,
    title: game.name,
    playtime_forever: game.playtime_forever || 0,
    last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
    cover_url: game.cover_url || null,
    backdrop_url: game.backdrop_url || null
  };
}

// Global guard against concurrent sync/maintenance operations (audit F9).
let syncInProgress = false;
const SYNC_BUSY_MESSAGE = 'Another sync or repair task is already running. Please wait for it to finish.';

// Verify whether an image URL actually loads cleanly (module scope so both
// maintenance handlers AND verifyAndFixSteamBackdrops can use it).
const imageValidationCache = new Map(); // url -> { valid, is404 }
const IMAGE_VALIDATION_CACHE_MAX = 500;

function isImageValidStatus(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return Promise.resolve({ valid: false, is404: false });
  const trimmed = url.trim();
  if (imageValidationCache.has(trimmed)) {
    return Promise.resolve(imageValidationCache.get(trimmed));
  }
  // Bound the cache: evict the oldest entry once full (Map preserves insertion order)
  if (imageValidationCache.size >= IMAGE_VALIDATION_CACHE_MAX) {
    const oldest = imageValidationCache.keys().next().value;
    if (oldest !== undefined) imageValidationCache.delete(oldest);
  }
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    // Increased timeout to 5000ms for slow networks
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        img.src = '';
        const res = { valid: false, is404: false }; // Timeout is NOT an explicit 404
        imageValidationCache.set(trimmed, res);
        resolve(res);
      }
    }, 5000);
    img.onload = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        const res = { valid: true, is404: false };
        imageValidationCache.set(trimmed, res);
        resolve(res);
      }
    };
    img.onerror = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        const res = { valid: false, is404: true }; // Explicit 404 / image load failure
        imageValidationCache.set(trimmed, res);
        resolve(res);
      }
    };
    img.src = trimmed;
  });
}

async function isImageValid(url) {
  const res = await isImageValidStatus(url);
  return res.valid;
}

// Setup Event Listeners
function setupEventListeners() {
  // Sidebar Collapse Toggle
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('crossplay_sidebar_collapsed', isCollapsed);
    });
  }

  // Navigation
  navLibrary.addEventListener('click', (e) => {
    e.preventDefault();
    showPage('library');
  });

  navSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showPage('settings');
  });

  emptyStateSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showPage('settings');
  });

  // Settings Tab Switching
  const settingsNavItems = document.querySelectorAll('.settings-nav-item');
  const settingsTabPanes = document.querySelectorAll('.settings-tab-pane');

  settingsNavItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-target-tab');
      
      // Update active nav item
      settingsNavItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Show target tab pane, hide others
      settingsTabPanes.forEach(pane => {
        if (pane.id === `tab-${targetTab}`) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });
    });
  });


  // Add Game Modal navigation
  addGameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openAddGame();
  });
  closeAddGameBtn.addEventListener('click', closeAddGame);
  addGameModal.addEventListener('click', (e) => {
    if (e.target === addGameModal) {
      closeAddGame();
    }
  });

  // Platform OS detection for search shortcut badge label
  const searchKbd = document.getElementById('search-kbd');
  const isMac = typeof navigator !== 'undefined' && (
    (navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0) ||
    (navigator.userAgent && navigator.userAgent.toUpperCase().indexOf('MAC') >= 0)
  );
  if (searchKbd) {
    searchKbd.textContent = isMac ? '⌘K' : 'Ctrl+K';
  }

  // Global Keyboard Shortcuts for Search (Ctrl+K / Cmd+K / Slash key / Escape)
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInputActive = activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.isContentEditable
    );

    // Ctrl+K or Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } 
    // "/" key (when not already typing inside an input or textarea and no modal is open)
    else if (e.key === '/' && !isInputActive && !activeModal) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } 
    // Escape key (blurs search input when focused)
    else if (e.key === 'Escape' && activeEl === searchInput) {
      searchInput.blur();
    }
  });

  // Search, Filter & Sort
  searchInput.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value.toLowerCase();
    renderGames();
  });

  sortSelect.addEventListener('change', (e) => {
    appState.sortKey = e.target.value;
    renderGames();
  });

  function updateFilterPillGlider(activeBtn, immediate = false) {
    const container = document.querySelector('.filter-tabs');
    const glider = document.getElementById('filter-pill-glider');
    if (!container || !glider) return;

    const btn = activeBtn || container.querySelector('.tab-btn.active') || container.querySelector('.tab-btn');
    if (!btn || btn.offsetParent === null) {
      glider.classList.remove('ready');
      return;
    }

    const left = btn.offsetLeft;
    const top = btn.offsetTop;
    const width = btn.offsetWidth;
    const height = btn.offsetHeight;

    if (width === 0 && height === 0) return;

    if (immediate) {
      glider.style.transition = 'none';
      glider.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      glider.style.width = `${width}px`;
      glider.style.height = `${height}px`;
      glider.classList.add('ready');
      void glider.offsetWidth;
      glider.style.transition = '';
    } else {
      glider.style.transition = '';
      glider.classList.add('ready');
      void glider.offsetWidth;
      glider.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      glider.style.width = `${width}px`;
      glider.style.height = `${height}px`;
    }

    if (container.scrollWidth > container.clientWidth) {
      const scrollLeft = btn.offsetLeft - (container.clientWidth / 2) + (btn.offsetWidth / 2);
      container.scrollTo({
        left: Math.max(0, scrollLeft),
        behavior: immediate ? 'auto' : 'smooth'
      });
    }
  }
  window.updateFilterPillGlider = updateFilterPillGlider;

  function syncFilterPressedState() {
    filterBtns.forEach(b => {
      const isActive = b.classList.contains('active');
      b.setAttribute('aria-pressed', String(isActive));
    });
  }
  syncFilterPressedState();
  updateFilterPillGlider(null, true);

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      if (target.classList.contains('active') && appState.filters === target.dataset.filter) {
        return;
      }
      filterBtns.forEach(b => b.classList.remove('active'));
      target.classList.add('active');
      appState.filters = target.dataset.filter;
      syncFilterPressedState();
      updateFilterPillGlider(target, false);
      
      requestAnimationFrame(() => {
        renderGames();
      });
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const idx = Array.from(filterBtns).indexOf(e.currentTarget);
        const next = filterBtns[(idx + dir + filterBtns.length) % filterBtns.length];
        if (next) {
          next.focus();
          next.click();
        }
      }
    });
  });

  const filterContainer = document.querySelector('.filter-tabs');
  if (filterContainer && window.ResizeObserver) {
    let prevWidth = 0;
    let prevHeight = 0;
    const filterResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (prevWidth === 0 || Math.abs(width - prevWidth) > 5 || Math.abs(height - prevHeight) > 5) {
          prevWidth = width;
          prevHeight = height;
          updateFilterPillGlider(null, true);
        }
      }
    });
    filterResizeObserver.observe(filterContainer);
  } else {
    window.addEventListener('resize', () => {
      updateFilterPillGlider(null, true);
    });
  }

  // Top navbar links
  document.querySelectorAll('.navbar-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const nav = link.dataset.nav;
      document.querySelectorAll('.navbar-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      if (nav === 'library') {
        showPage('library');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        showToast(`${link.textContent.trim()} is coming soon`, 'info');
      }
    });
  });

  // Initialize 3D Parallax Tilt & Specular Glare on game cards
  function initCardParallaxTilt() {
    if (!gamesGrid) return;
    if (window.matchMedia && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    let activeCard = null;
    let rafId = null;

    gamesGrid.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.game-card');
      if (!card) {
        if (activeCard) {
          resetCardTilt(activeCard);
          activeCard = null;
        }
        return;
      }

      if (activeCard && activeCard !== card) {
        resetCardTilt(activeCard);
      }
      activeCard = card;

      const rect = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const tiltX = (0.5 - y) * 14;
      const tiltY = (x - 0.5) * 14;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        card.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
        card.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
        card.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
        card.classList.add('is-tilting');
      });
    });

    gamesGrid.addEventListener('pointerleave', () => {
      if (activeCard) {
        resetCardTilt(activeCard);
        activeCard = null;
      }
    });

    function resetCardTilt(card) {
      card.classList.remove('is-tilting');
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
      card.style.removeProperty('--glare-x');
      card.style.removeProperty('--glare-y');
    }
  }
  initCardParallaxTilt();

  // Steam config save
  saveSteamBtn.addEventListener('click', async () => {
    const inputVal = steamIdentifierInput.value.trim();
    if (!inputVal) {
      showToast('Please enter a Steam ID or vanity URL', 'error');
      return;
    }
    
    saveSteamBtn.disabled = true;
    saveSteamBtn.textContent = 'Resolving...';
    
    try {
      let resolvedSteamId = inputVal;
      let vanityName = '';
      
      if (!/^\d{17}$/.test(inputVal)) {
        const resolveRes = await fetch(`/api/steam/resolve?vanityUrl=${encodeURIComponent(inputVal)}`);
        const resolveData = await resolveRes.json();
        
        if (resolveData.response && resolveData.response.success === 1) {
          resolvedSteamId = resolveData.response.steamid;
          vanityName = inputVal;
        } else {
          throw new Error('Could not resolve vanity URL. Make sure it is your exact custom profile name.');
        }
      }
      
      appState.steamId = resolvedSteamId;
      appState.vanityUrl = vanityName;
      saveSettingsToStorage();
      
      resolvedProfileCard.classList.remove('hidden');
      resolvedName.textContent = vanityName ? `@${vanityName}` : 'Steam Account';
      resolvedId.textContent = `ID: ${resolvedSteamId}`;
      
      showToast('Steam integration configuration saved!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      resolvedProfileCard.classList.add('hidden');
    } finally {
      saveSteamBtn.disabled = false;
      saveSteamBtn.textContent = 'Apply';
    }
  });

  // GOG config save
  saveGogBtn.addEventListener('click', () => {
    const username = gogUsernameInput.value.trim();
    if (!username) {
      showToast('Please enter a GOG username', 'error');
      return;
    }
    
    appState.gogUsername = username;
    saveSettingsToStorage();
    
    resolvedGogCard.classList.remove('hidden');
    resolvedGogName.textContent = `@${username}`;
    resolvedGogId.textContent = `Username: ${username}`;
    
    showToast('GOG integration configuration saved!', 'success');
  });

  // STOVE config save
  if (saveStoveBtn) {
    saveStoveBtn.addEventListener('click', () => {
      const rawInput = stoveMemberNoInput.value.trim();
      if (!rawInput) {
        showToast('Please enter a STOVE Member ID or Profile URL', 'error');
        return;
      }
      
      const memberNo = extractStoveMemberNo(rawInput);
      if (!memberNo) {
        showToast('Invalid STOVE Member ID or Profile URL', 'error');
        return;
      }

      appState.stoveMemberNo = memberNo;
      stoveMemberNoInput.value = memberNo;
      saveSettingsToStorage();

      resolvedStoveCard.classList.remove('hidden');
      resolvedStoveName.textContent = 'STOVE Account';
      resolvedStoveId.textContent = `Member ID: ${memberNo}`;

      showToast('STOVE integration configuration saved!', 'success');
    });
  }

  // Itch.io config save
  if (saveItchBtn) {
    saveItchBtn.addEventListener('click', () => {
      const rawInput = itchCollectionUrlInput.value.trim();
      if (!rawInput) {
        showToast('Please enter an Itch.io Collection URL', 'error');
        return;
      }
      
      const colUrl = extractItchCollectionUrl(rawInput);
      if (!colUrl || !colUrl.includes('itch.io/c/')) {
        showToast('Invalid Itch.io Collection URL. Expected: https://itch.io/c/12345/collection-name', 'error');
        return;
      }

      appState.itchCollectionUrl = colUrl;
      itchCollectionUrlInput.value = colUrl;
      saveSettingsToStorage();

      resolvedItchCard.classList.remove('hidden');
      resolvedItchName.textContent = 'Itch.io Collection';
      resolvedItchId.textContent = 'Collection: Connected';

      showToast('Itch.io collection configuration saved!', 'success');
    });
  }

  // Epic Games - Copy Extractor Script
  copyEpicScriptBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EPIC_EXTRACTOR_SCRIPT);
      showToast('Extractor script copied to clipboard! Run it on Epic Transactions page.', 'success');
    } catch (err) {
      showToast('Failed to copy automatically. Please copy the script from the source.', 'error');
    }
  });

  // Shared importer for pasted extractor JSON — Epic, Legacy, IndieGala (audit F3.2).
  // Every parsed game passes through sanitizeGame() before it can reach
  // state or the database (audit F2: pasted text is untrusted input).
  async function importPastedLibrary({ inputEl, buttonEl, resolvedCardEl, connectedFlagKey, platform }) {
    const rawJson = inputEl.value.trim();
    if (!rawJson) {
      showToast('Please paste the extracted JSON array first!', 'error');
      return;
    }

    const idleLabel = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = 'Parsing & Importing...';

    try {
      let jsonToParse = rawJson;
      const startIdx = rawJson.indexOf('[');
      const endIdx = rawJson.lastIndexOf(']');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonToParse = rawJson.substring(startIdx, endIdx + 1);
      }

      const parsed = JSON.parse(jsonToParse);
      if (!Array.isArray(parsed)) {
        throw new Error('Pasted content is not a valid JSON array. Please rerun the script and copy the full output.');
      }

      showToast(`Pasted ${parsed.length} games. Resolving cover arts via Steam API...`, 'info');

      // Map extractor JSON properties to our internal format
      const existingMap = new Map();
      appState.games.filter(g => g.platform === platform).forEach(g => {
        existingMap.set(String(g.external_id), g);
      });

      const newGames = parsed
        .filter(game => !shouldExcludeGame(game.title, game.id))
        .map(game => {
          const extId = game.id || String(Math.floor(Math.random() * 1000000));
          const existing = existingMap.get(extId);
          return sanitizeGame({
            external_id: extId,
            platform,
            appid: game.id || '',
            name: game.title,
            playtime_forever: (existing && existing.playtime_forever) ? existing.playtime_forever : 0,
            rtime_last_played: game.date ? Math.floor(new Date(game.date).getTime() / 1000) : ((existing && existing.rtime_last_played) ? existing.rtime_last_played : 0),
            cover_url: (existing && existing.cover_url) ? existing.cover_url : (game.cover_url || null),
            backdrop_url: (existing && existing.backdrop_url) ? existing.backdrop_url : (game.backdrop_url || null)
          });
        })
        .filter(Boolean);

      // Resolve cover arts in parallel chunks to avoid server overloading
      const batchSize = 10;
      for (let i = 0; i < newGames.length; i += batchSize) {
        const batch = newGames.slice(i, i + batchSize);

        await Promise.all(batch.map(async game => {
          try {
            const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
            if (res.ok) {
              const coverData = await res.json();
              if (coverData.cover_url) {
                game.cover_url = coverData.cover_url;
              }
              if (coverData.backdrop_url) {
                game.backdrop_url = coverData.backdrop_url;
              }
            }
          } catch (e) {
            console.error(`Failed to resolve cover for ${game.name}:`, e);
          }
        }));
      }

      // Merge into state (overwrite only this platform, preserve the rest)
      appState.games = deduplicateGamesList([
        ...appState.games.filter(g => g.platform !== platform),
        ...newGames
      ], false);

      appState[connectedFlagKey] = true;
      saveSettingsToStorage();

      resolvedCardEl.classList.remove('hidden');
      inputEl.value = '';

      if (isCloudEnabled()) {
        showToast(`Syncing ${platform} library to Supabase...`, 'info');
        await syncGamesToSupabase(appState.games);
      }

      emptyState.classList.add('hidden');
      renderGames();
      updateStats();
      showToast(`Successfully imported ${newGames.length} ${platform} Games!`, 'success');
      showPage('library');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    } finally {
      buttonEl.disabled = false;
      buttonEl.textContent = idleLabel;
    }
  }

  // Legacy Games - Copy Extractor Script
  if (copyLegacyScriptBtn) {
    copyLegacyScriptBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(LEGACY_EXTRACTOR_SCRIPT);
        showToast('Extractor script copied to clipboard! Run it on Legacy Games Downloads/Free Games page.', 'success');
      } catch (err) {
        showToast('Failed to copy automatically. Please copy the script from the source.', 'error');
      }
    });
  }

  // IndieGala - Copy Extractor Script
  if (copyIndiegalaScriptBtn) {
    copyIndiegalaScriptBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(INDIEGALA_EXTRACTOR_SCRIPT);
        showToast('Extractor script copied to clipboard! Run it on IndieGala Library / Showcase page.', 'success');
      } catch (err) {
        showToast('Failed to copy automatically. Please copy the script from the source.', 'error');
      }
    });
  }

  // Epic Games - Import Paste Action
  importEpicBtn.addEventListener('click', () => {
    importPastedLibrary({
      inputEl: epicJsonInput,
      buttonEl: importEpicBtn,
      resolvedCardEl: resolvedEpicCard,
      connectedFlagKey: 'epicConnected',
      platform: 'Epic'
    });
  });

  // Legacy Games - Import Paste Action
  importLegacyBtn.addEventListener('click', () => {
    importPastedLibrary({
      inputEl: legacyJsonInput,
      buttonEl: importLegacyBtn,
      resolvedCardEl: resolvedLegacyCard,
      connectedFlagKey: 'legacyConnected',
      platform: 'Legacy'
    });
  });

  // IndieGala - Import Paste Action
  if (importIndiegalaBtn) {
    importIndiegalaBtn.addEventListener('click', () => {
      importPastedLibrary({
        inputEl: indiegalaJsonInput,
        buttonEl: importIndiegalaBtn,
        resolvedCardEl: resolvedIndiegalaCard,
        connectedFlagKey: 'indiegalaConnected',
        platform: 'IndieGala'
      });
    });
  }
  // Supabase connections are now handled automatically via backend configuration.

  // Platform Sync triggers (merged button syncs all configured platforms; dropdown syncs individually)
  syncAllBtn.addEventListener('click', () => {
    const configuredPlatforms = [];
    if (appState.steamId) configuredPlatforms.push('Steam');
    if (appState.gogUsername) configuredPlatforms.push('GOG');
    if (appState.stoveMemberNo) configuredPlatforms.push('Stove');
    if (appState.itchCollectionUrl) configuredPlatforms.push('Itch');
    
    if (configuredPlatforms.length === 0) {
      // Default to trying all platforms and prompting for missing settings if none configured
      triggerSync(['Steam', 'GOG', 'Stove', 'Itch']);
    } else {
      triggerSync(configuredPlatforms);
    }
  });
  syncDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = syncMenu.classList.contains('hidden');
    if (willOpen) openSyncMenu();
    else closeSyncMenu(false);
  });
  const syncMenuItems = Array.from(syncMenu.querySelectorAll('.sync-menu-item'));
  function closeSyncMenu(returnFocus) {
    syncMenu.classList.add('hidden');
    syncDropdownToggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) syncDropdownToggle.focus();
  }
  function openSyncMenu() {
    syncMenu.classList.remove('hidden');
    syncDropdownToggle.setAttribute('aria-expanded', 'true');
    if (syncMenuItems[0]) syncMenuItems[0].focus();
  }
  syncMenuItems.forEach(item => {
    item.addEventListener('click', () => {
      const platform = item.dataset.sync;
      closeSyncMenu(false);
      triggerSync([platform]);
    });
  });
  syncDropdownToggle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (syncMenu.classList.contains('hidden')) openSyncMenu();
    } else if (e.key === 'Escape') {
      closeSyncMenu(true);
    }
  });
  syncMenu.addEventListener('keydown', (e) => {
    const idx = syncMenuItems.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = syncMenuItems[(idx + 1) % syncMenuItems.length];
      if (next) next.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = syncMenuItems[(idx - 1 + syncMenuItems.length) % syncMenuItems.length];
      if (prev) prev.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSyncMenu(true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (syncMenuItems[0]) syncMenuItems[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      if (syncMenuItems[syncMenuItems.length - 1]) syncMenuItems[syncMenuItems.length - 1].focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!syncMenu.contains(e.target) && e.target !== syncDropdownToggle && !syncDropdownToggle.contains(e.target)) {
      closeSyncMenu(false);
    }
  });

  // Toggle custom platform input visibility
  manualPlatformInput.addEventListener('change', () => {
    if (manualPlatformInput.value === 'Other') {
      customPlatformGroup.classList.remove('hidden');
      manualCustomPlatformInput.required = true;
    } else {
      customPlatformGroup.classList.add('hidden');
      manualCustomPlatformInput.required = false;
      manualCustomPlatformInput.value = '';
    }
  });

  // Store Catalog Search trigger (Steam / IGDB)
  steamSearchBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const term = steamSearchInput.value.trim();
    if (!term) {
      showToast('Please enter a game name to search', 'info');
      return;
    }

    const source = searchSourceSelect.value;
    steamSearchBtn.disabled = true;
    steamSearchBtn.textContent = 'Searching...';
    steamSearchResults.innerHTML = '';
    steamSearchResults.classList.add('hidden');

    try {
      const endpoint = source === 'igdb' ? '/api/igdb/search' : '/api/steam/search';
      const response = await fetch(`${endpoint}?term=${encodeURIComponent(term)}`);
      if (!response.ok) {
        if (source === 'igdb') {
          throw new Error('IGDB Search failed. Make sure your Twitch developer keys are configured in .env and restart server.');
        } else {
          throw new Error('Steam store search failed.');
        }
      }
      const items = await response.json();

      if (items.length === 0) {
        steamSearchResults.innerHTML = `<div style="padding: 0.75rem; font-size: 0.85rem; color: var(--text-muted);">No games found on ${source === 'igdb' ? 'IGDB' : 'Steam'}.</div>`;
        steamSearchResults.classList.remove('hidden');
        return;
      }

      items.slice(0, 5).forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
          <img class="search-result-img" src="${safeArtUrl(item.tiny_image)}" alt="${escapeHtml(item.name)}">
          <span class="search-result-name">${escapeHtml(item.name)}</span>
        `;
        div.addEventListener('click', () => {
          manualTitleInput.value = item.name;
          
          if (source === 'igdb') {
            manualCoverInput.value = item.cover_url || '';
            // Attempt to guess platform matching dropdown
            let platformGuess = 'Steam';
            if (item.platforms && item.platforms.length > 0) {
              const lowerPlatforms = item.platforms.map(p => p.toLowerCase());
              if (lowerPlatforms.some(p => p.includes('gog'))) {
                platformGuess = 'GOG';
              } else if (lowerPlatforms.some(p => p.includes('epic'))) {
                platformGuess = 'Epic';
              } else if (lowerPlatforms.some(p => p.includes('ubisoft') || p.includes('uplay'))) {
                platformGuess = 'Ubisoft';
              } else if (lowerPlatforms.some(p => p.includes('indiegala') || p.includes('gala'))) {
                platformGuess = 'IndieGala';
              } else if (lowerPlatforms.some(p => p.includes('itch'))) {
                platformGuess = 'Itch.io';
              } else if (lowerPlatforms.some(p => p.includes('stove'))) {
                platformGuess = 'Stove';
              } else if (lowerPlatforms.some(p => p.includes('steam') || p.includes('pc') || p.includes('windows') || p.includes('mac') || p.includes('linux'))) {
                platformGuess = 'Steam';
              } else if (lowerPlatforms.some(p => p.includes('xbox'))) {
                platformGuess = 'Microsoft Store';
              } else if (lowerPlatforms.some(p => p.includes('amazon'))) {
                platformGuess = 'Amazon Gaming';
              } else {
                platformGuess = 'Other';
              }
            }
            manualPlatformInput.value = platformGuess;
            if (platformGuess === 'Other') {
              customPlatformGroup.classList.remove('hidden');
              manualCustomPlatformInput.required = true;
              const otherPlatform = item.platforms.find(p => !p.toLowerCase().includes('pc') && !p.toLowerCase().includes('windows') && !p.toLowerCase().includes('mac') && !p.toLowerCase().includes('linux'));
              manualCustomPlatformInput.value = otherPlatform || '';
            } else {
              customPlatformGroup.classList.add('hidden');
              manualCustomPlatformInput.required = false;
              manualCustomPlatformInput.value = '';
            }
          } else {
            manualPlatformInput.value = 'Steam';
            customPlatformGroup.classList.add('hidden');
            manualCustomPlatformInput.required = false;
            manualCustomPlatformInput.value = '';
            manualCoverInput.value = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`;
          }
          
          steamSearchResults.classList.add('hidden');
          steamSearchInput.value = '';
          showToast(`Auto-filled details for ${item.name}!`, 'success');
        });
        steamSearchResults.appendChild(div);
      });

      steamSearchResults.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to query ${source === 'igdb' ? 'IGDB' : 'Steam'} store`, 'error');
    } finally {
      steamSearchBtn.disabled = false;
      steamSearchBtn.textContent = 'Search';
    }
  });

  // Manual Add Form Submit trigger
  addGameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = manualTitleInput.value.trim();
    let platform = manualPlatformInput.value;
    if (platform === 'Other') {
      platform = manualCustomPlatformInput.value.trim() || 'Other';
    }
    const coverUrl = manualCoverInput.value.trim() || null;
    const playtimeHours = parseFloat(manualPlaytimeInput.value) || 0;
    const lastPlayedStr = manualLastPlayedInput.value;

    if (!title) {
      showToast('Game title is required', 'error');
      return;
    }

    const externalId = 'manual_' + Date.now();
    const playtimeMinutes = Math.round(playtimeHours * 60);
    const lastPlayedTimestamp = lastPlayedStr ? Math.floor(new Date(lastPlayedStr).getTime() / 1000) : 0;

    const newGame = {
      external_id: externalId,
      platform: platform,
      appid: externalId,
      name: title,
      playtime_forever: playtimeMinutes,
      rtime_last_played: lastPlayedTimestamp,
      cover_url: coverUrl
    };

    // Check for duplicates (normalized title comparison, consistent with the rest of the app — audit F10)
    const exists = appState.games.some(g => g.platform === platform && normalizeGameTitle(g.name) === normalizeGameTitle(title));
    if (exists) {
      showToast(`"${title}" is already in your library on ${platform}!`, 'error');
      return;
    }

    // Add to state
    appState.games.push(newGame);
    saveSettingsToStorage();

    // Sync with Supabase if enabled (via backend proxy)
    if (isCloudEnabled()) {
      try {
        await dbUpsertGames([toDbRow(newGame)]);
        showToast('Synced to cloud database successfully!', 'success');
      } catch (err) {
        console.error(err);
        showToast(`Cloud sync failed: ${err.message}`, 'error');
      }
    }

    emptyState.classList.add('hidden');
    renderGames();
    updateStats();

    // Reset form & close
    addGameForm.reset();
    customPlatformGroup.classList.add('hidden');
    manualCustomPlatformInput.required = false;
    manualCustomPlatformInput.value = '';
    closeAddGame();
    showToast(`Successfully added "${title}"!`, 'success');
  });

  // Shared artwork-resolution routine for the maintenance buttons (audit F3.1).
  // Guarded by the global syncInProgress flag so it can never interleave
  // with a running platform sync or another repair task.
  async function resolveArtworkFor(targetGames, { button, busyHtml, idleHtml, startToast, successToast, failureToast }) {
    if (syncInProgress) {
      showToast(SYNC_BUSY_MESSAGE, 'info');
      return;
    }

    button.disabled = true;
    button.innerHTML = busyHtml;
    lucide.createIcons();
    showToast(startToast, 'info');

    let resolvedCount = 0;
    const batchSize = 5;
    try {
      for (let i = 0; i < targetGames.length; i += batchSize) {
        const batch = targetGames.slice(i, i + batchSize);
        await Promise.all(batch.map(async game => {
          try {
            const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.cover_url) {
                game.cover_url = data.cover_url;
                resolvedCount++;

                if (data.backdrop_url) {
                  game.backdrop_url = data.backdrop_url;
                }

                if (isCloudEnabled()) {
                  await dbUpsertGames([toDbRow(game)]);
                }
              }
            }
          } catch (e) {
            console.error(`Failed to resolve cover for ${game.name}:`, e);
          }
        }));
      }

      saveSettingsToStorage();
      renderGames();
      updateStats();

      if (resolvedCount > 0) {
        showToast(successToast(resolvedCount), 'success');
      } else {
        showToast(failureToast, 'info');
      }
    } finally {
      button.disabled = false;
      button.innerHTML = idleHtml;
      lucide.createIcons();
    }
  }

  // Resolve Missing Covers trigger
  resolveCoversBtn.addEventListener('click', () => {
    const missingCoverGames = appState.games.filter(g => !g.cover_url);
    if (missingCoverGames.length === 0) {
      showToast('All games in your library already have cover art!', 'info');
      return;
    }
    resolveArtworkFor(missingCoverGames, {
      button: resolveCoversBtn,
      busyHtml: '<i class="inline-icon syncing-rotate" data-lucide="refresh-cw"></i> Resolving...',
      idleHtml: '<i data-lucide="image-down" class="inline-icon"></i> Scan & Resolve Missing Covers',
      startToast: `Scanning and resolving covers for ${missingCoverGames.length} games...`,
      successToast: (n) => `Successfully resolved cover art for ${n} games!`,
      failureToast: 'Could not find cover art for any of the missing games.'
    });
  });

  // Resolve GOG landscape covers trigger
  resolveGogCoversBtn.addEventListener('click', () => {
    const gogGames = appState.games.filter(g => g.platform === 'GOG');
    if (gogGames.length === 0) {
      showToast('No GOG games in your library to resolve covers for!', 'info');
      return;
    }
    resolveArtworkFor(gogGames, {
      button: resolveGogCoversBtn,
      busyHtml: '<i class="inline-icon syncing-rotate" data-lucide="refresh-cw"></i> Resolving GOG Covers...',
      idleHtml: '<i data-lucide="image" class="inline-icon"></i> Upgrade GOG Covers to Vertical (IGDB/Steam)',
      startToast: `Scanning and upgrading covers for ${gogGames.length} GOG games...`,
      successToast: (n) => `Successfully upgraded cover art for ${n} GOG games!`,
      failureToast: 'Could not find vertical cover art for any GOG games.'
    });
  });

  // NOTE: isImageValid / isImageValidStatus now live at module scope so that
  // verifyAndFixSteamBackdrops() (which previously hit a ReferenceError) can
  // also use them.

  // Refresh & Repair Backdrops: populate or replace ONLY missing or invalid (broken 404) backdrops.
  // NEVER modifies cover_url! Clears existing backdrops ONLY on explicit 404 error!
  refreshArtworkBtn.addEventListener('click', async () => {
    if (appState.games.length === 0) {
      showToast('Your library is empty. Sync a platform first!', 'info');
      return;
    }
    if (syncInProgress) {
      showToast(SYNC_BUSY_MESSAGE, 'info');
      return;
    }
    syncInProgress = true;
    try {
      await runBackdropRepair();
    } finally {
      syncInProgress = false;
    }
  });

  async function runBackdropRepair() {
    const progressContainer = document.getElementById('backdrop-progress-container');
    const progressText = document.getElementById('backdrop-progress-text');
    const progressPercent = document.getElementById('backdrop-progress-percent');
    const progressFill = document.getElementById('backdrop-progress-fill');

    refreshArtworkBtn.disabled = true;
    refreshArtworkBtn.innerHTML = '<i class="inline-icon syncing-rotate" data-lucide="refresh-cw"></i> Checking & repairing backdrops...';
    lucide.createIcons();

    if (progressContainer) {
      progressContainer.style.display = 'block';
      if (progressFill) progressFill.style.width = '0%';
      if (progressPercent) progressPercent.textContent = '0%';
      if (progressText) progressText.innerHTML = `<i data-lucide="loader-2" class="inline-icon syncing-rotate"></i> Checking backdrops (0 / ${appState.games.length})...`;
      lucide.createIcons();
    }

    let resolvedCount = 0;
    let processedCount = 0;
    const totalGames = appState.games.length;
    const batchSize = 10; // Lower concurrency to prevent browser socket queueing

    for (let i = 0; i < appState.games.length; i += batchSize) {
      const batch = appState.games.slice(i, i + batchSize);
      await Promise.all(batch.map(async game => {
        try {
          // 1. Check if current backdrop URL is valid
          const currentUrl = game.backdrop_url ? String(game.backdrop_url).trim() : null;
          const checkStatus = currentUrl ? await isImageValidStatus(currentUrl) : { valid: false, is404: false };

          if (checkStatus.valid) {
            // Backdrop is already valid and working! Skip.
            return;
          }

          // 2. Backdrop is missing or broken -> attempt repair/fetch candidate
          let candidateBackdrop = null;

          // For Steam games, test native hero URL first
          if (game.platform === 'Steam' && game.appid) {
            const steamHero = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_hero.jpg`;
            if (currentUrl !== steamHero && await isImageValid(steamHero)) {
              candidateBackdrop = steamHero;
            }
          }

          // If still no valid backdrop candidate, query IGDB / Steam store search API
          if (!candidateBackdrop) {
            const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.backdrop_url && data.backdrop_url !== currentUrl && await isImageValid(data.backdrop_url)) {
                candidateBackdrop = data.backdrop_url;
              }
            }
          }

          // 3. Apply backdrop change if found, or clear ONLY if existing URL had explicit 404 error
          if (candidateBackdrop) {
            game.backdrop_url = candidateBackdrop;
            resolvedCount++;
          } else if (currentUrl && checkStatus.is404) {
            // CLEAR ONLY IF EXPLICIT 404 ERROR!
            game.backdrop_url = null;
            resolvedCount++;
          } else {
            return; // Timed out or missing initially without candidate -> DO NOT TOUCH game.backdrop_url!
          }

          // Sync backdrop change to Supabase (WITHOUT touching cover_url)
          if (isCloudEnabled()) {
            await dbUpsertGames([toDbRow(game)]);
          }
        } catch (e) {
          console.error(`Failed to repair backdrop for ${game.name}:`, e);
        } finally {
          processedCount++;
          if (progressContainer) {
            const pct = Math.min(100, Math.round((processedCount / totalGames) * 100));
            if (progressFill) progressFill.style.width = `${pct}%`;
            if (progressPercent) progressPercent.textContent = `${pct}%`;
            if (progressText) progressText.innerHTML = `<i data-lucide="loader-2" class="inline-icon syncing-rotate"></i> Checking backdrops (${processedCount} / ${totalGames})...`;
            lucide.createIcons();
          }
        }
      }));
    }

    saveSettingsToStorage();
    renderGames();
    updateStageBackground();
    updateStats();

    if (progressContainer) {
      if (progressFill) progressFill.style.width = '100%';
      if (progressPercent) progressPercent.textContent = '100%';
      if (progressText) progressText.innerHTML = `<i data-lucide="check-circle" class="inline-icon" style="color: #10b981;"></i> Repair complete! (${resolvedCount} updated)`;
      lucide.createIcons();
    }

    refreshArtworkBtn.disabled = false;
    refreshArtworkBtn.innerHTML = '<i data-lucide="image" class="inline-icon"></i> Refresh & Repair Backdrops';
    lucide.createIcons();

    if (resolvedCount > 0) {
      showToast(`Repaired & updated backdrops for ${resolvedCount} games!`, 'success');
    } else {
      showToast('All game backdrops are already valid and working!', 'info');
    }

    // Auto-hide progress bar after 5 seconds
    setTimeout(() => {
      if (progressContainer && !refreshArtworkBtn.disabled) {
        progressContainer.style.display = 'none';
      }
    }, 5000);
  }

  gamesGrid.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('game-card')) {
      e.preventDefault();
      const platform = e.target.getAttribute('data-platform');
      const externalId = e.target.getAttribute('data-external-id');
      if (platform && externalId) openEditGameSidebar(platform, externalId);
    }
  });

  // Click delegation on gamesGrid for delete and edit-cover buttons
  gamesGrid.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.delete-game-btn');
    if (deleteBtn) {
      e.stopPropagation();
      const platform = deleteBtn.getAttribute('data-platform');
      const externalId = deleteBtn.getAttribute('data-external-id');
      const name = deleteBtn.getAttribute('data-name');
      deleteAndIgnoreGame(platform, externalId, name);
      return;
    }

    const editCoverBtn = e.target.closest('.edit-cover-btn');
    if (editCoverBtn) {
      e.stopPropagation();
      const platform = editCoverBtn.getAttribute('data-platform');
      const externalId = editCoverBtn.getAttribute('data-external-id');
      openEditGameSidebar(platform, externalId);
      return;
    }
  });

  // Edit Game Sidebar Modal Listeners
  const editGameModal = document.getElementById('edit-game-modal');
  const closeEditGameBtn = document.getElementById('close-edit-game-btn');
  const editGameForm = document.getElementById('edit-game-form');
  const editGameBlacklistBtn = document.getElementById('edit-game-blacklist-btn');
  const editGameDeleteBtn = document.getElementById('edit-game-delete-btn');
  const editSearchInput = document.getElementById('edit-search-input');
  const editSearchSourceSelect = document.getElementById('edit-search-source-select');
  const editSearchBtn = document.getElementById('edit-search-btn');
  const editSearchResults = document.getElementById('edit-search-results');

  if (closeEditGameBtn && editGameModal) {
    closeEditGameBtn.addEventListener('click', () => {
      closeEditGameModal();
    });
    editGameModal.addEventListener('click', (e) => {
      if (e.target === editGameModal) {
        closeEditGameModal();
      }
    });
  }

  // Confirm Dialog actions (audit F10.3)
  if (confirmModalEl) {
    const confirmOkBtn = document.getElementById('confirm-ok-btn');
    const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    if (confirmOkBtn) {
      confirmOkBtn.addEventListener('click', () => {
        closeModal(confirmModalEl);
        resolveConfirm(true);
      });
    }
    if (confirmCancelBtn) {
      confirmCancelBtn.addEventListener('click', () => {
        closeModal(confirmModalEl);
        resolveConfirm(false);
      });
    }
    // Click on the dimmed backdrop cancels, matching the other modals
    confirmModalEl.addEventListener('click', (e) => {
      if (e.target === confirmModalEl) {
        closeModal(confirmModalEl);
        resolveConfirm(false);
      }
    });
  }

  // Edit Game Search Artwork trigger
  if (editSearchBtn && editSearchInput) {
    editSearchBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const term = editSearchInput.value.trim();
      if (!term) {
        showToast('Please enter a game name to search artwork', 'info');
        return;
      }

      const source = editSearchSourceSelect.value;
      editSearchBtn.disabled = true;
      editSearchBtn.textContent = 'Searching...';
      editSearchResults.innerHTML = '';
      editSearchResults.classList.add('hidden');

      try {
        const endpoint = source === 'igdb' ? '/api/igdb/search' : '/api/steam/search';
        const response = await fetch(`${endpoint}?term=${encodeURIComponent(term)}`);
        if (!response.ok) throw new Error('Search failed');
        const items = await response.json();

        if (items.length === 0) {
          editSearchResults.innerHTML = `<div style="padding: 0.75rem; font-size: 0.85rem; color: var(--text-muted);">No artwork found on ${source === 'igdb' ? 'IGDB' : 'Steam'}.</div>`;
          editSearchResults.classList.remove('hidden');
          return;
        }

        items.slice(0, 5).forEach(item => {
          const div = document.createElement('div');
          div.className = 'search-result-item';
          div.innerHTML = `
            <img class="search-result-img" src="${safeArtUrl(item.tiny_image)}" alt="${escapeHtml(item.name)}">
            <span class="search-result-name">${escapeHtml(item.name)}</span>
          `;
          div.addEventListener('click', () => {
            const coverInput = document.getElementById('edit-game-cover');
            const backdropInput = document.getElementById('edit-game-backdrop');
            
            if (item.cover_url) coverInput.value = item.cover_url;
            if (item.backdrop_url) backdropInput.value = item.backdrop_url;
            
            editSearchResults.classList.add('hidden');
            showToast(`Applied artwork for "${item.name}"!`, 'info');
            
            coverInput.dispatchEvent(new Event('input'));
          });
          editSearchResults.appendChild(div);
        });
        editSearchResults.classList.remove('hidden');
      } catch (err) {
        showToast(`Artwork search failed: ${err.message}`, 'error');
      } finally {
        editSearchBtn.disabled = false;
        editSearchBtn.textContent = 'Search';
      }
    });
  }

  // Edit Game Form Submit (Save Changes)
  if (editGameForm) {
    editGameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const origPlatform = document.getElementById('edit-game-orig-platform').value;
      const origExtId = document.getElementById('edit-game-orig-ext-id').value;

      const game = appState.games.find(g => g.platform === origPlatform && String(g.external_id) === String(origExtId));
      if (!game) return;

      const newTitle = document.getElementById('edit-game-title').value.trim();
      const newPlatform = document.getElementById('edit-game-platform').value;
      const newCover = document.getElementById('edit-game-cover').value.trim() || null;
      const newBackdrop = document.getElementById('edit-game-backdrop').value.trim() || null;
      const newHours = parseFloat(document.getElementById('edit-game-playtime').value) || 0;
      const newLastPlayedDate = document.getElementById('edit-game-lastplayed').value;

      // Update game object in state
      game.name = newTitle;
      game.platform = newPlatform;
      game.cover_url = newCover;
      game.backdrop_url = newBackdrop;
      game.playtime_forever = Math.round(newHours * 60);

      if (newLastPlayedDate) {
        game.rtime_last_played = Math.floor(new Date(newLastPlayedDate).getTime() / 1000);
      }

      // A rename/re-platform can create a duplicate with an existing entry —
      // dedupe at this mutation point (render no longer dedupes; audit F10.1)
      appState.games = deduplicateGamesList(appState.games, false);

      saveSettingsToStorage();

      // Cloud DB Sync
      if (isCloudEnabled()) {
        try {
          if (origPlatform !== newPlatform) {
            await dbDeleteGames([{ platform: origPlatform, external_id: String(origExtId) }]);
          }

          await dbUpsertGames([toDbRow(game)]);
          showToast(`Saved changes for "${game.name}" in database!`, 'success');
        } catch (err) {
          console.error(err);
          showToast(`Cloud update failed: ${err.message}`, 'error');
        }
      } else {
        showToast(`Saved changes for "${game.name}"!`, 'success');
      }

      editGameModal.classList.remove('open');
      renderGames();
      updateStats();
    });
  }

  // Edit Game Blacklist Action
  if (editGameBlacklistBtn) {
    editGameBlacklistBtn.addEventListener('click', () => {
      const origPlatform = document.getElementById('edit-game-orig-platform').value;
      const origExtId = document.getElementById('edit-game-orig-ext-id').value;
      const game = appState.games.find(g => g.platform === origPlatform && String(g.external_id) === String(origExtId));
      if (!game) return;

      editGameModal.classList.remove('open');
      deleteAndIgnoreGame(origPlatform, origExtId, game.name);
    });
  }

  // Edit Game Delete Action
  if (editGameDeleteBtn) {
    editGameDeleteBtn.addEventListener('click', async () => {
      const origPlatform = document.getElementById('edit-game-orig-platform').value;
      const origExtId = document.getElementById('edit-game-orig-ext-id').value;
      const game = appState.games.find(g => g.platform === origPlatform && String(g.external_id) === String(origExtId));
      if (!game) return;

      const okDelete = await showConfirm({
        title: 'Delete game?',
        message: `Are you sure you want to delete "${game.name}" from your library?`,
        confirmLabel: 'Delete',
        danger: true
      });
      if (!okDelete) {
        return;
      }

      appState.games = appState.games.filter(g => !(g.platform === origPlatform && String(g.external_id) === String(origExtId)));
      saveSettingsToStorage();

      if (isCloudEnabled()) {
        try {
          await dbDeleteGames([{ platform: origPlatform, external_id: String(origExtId) }]);
          showToast(`Deleted "${game.name}" from cloud database!`, 'success');
        } catch (err) {
          console.error(err);
          showToast(`Failed to delete from database: ${err.message}`, 'error');
        }
      } else {
        showToast(`Deleted "${game.name}" from library.`, 'success');
      }

      editGameModal.classList.remove('open');
      renderGames();
      updateStats();
    });
  }

  // Export JSON Backup
  if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', () => {
      if (!appState.games || appState.games.length === 0) {
        showToast('Your library is empty. Nothing to backup!', 'info');
        return;
      }

      const backupData = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        games: appState.games,
        steamId: appState.steamId,
        vanityUrl: appState.vanityUrl,
        gogUsername: appState.gogUsername,
        epicConnected: appState.epicConnected,
        legacyConnected: appState.legacyConnected,
        indiegalaConnected: appState.indiegalaConnected,
        blacklistAppIds: appState.blacklistAppIds,
        blacklistTitles: appState.blacklistTitles
      };

      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `pc_game_tracker_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Library backup exported successfully!', 'success');
    });
  }

  // Import JSON Backup trigger
  if (importBackupBtn && backupFileInput) {
    importBackupBtn.addEventListener('click', () => {
      backupFileInput.click();
    });

    backupFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (!parsed.games || !Array.isArray(parsed.games)) {
            throw new Error('Invalid backup file: missing games list');
          }

          // Validate every game object before it can reach state or the DB —
          // a malicious backup file is otherwise a persistence-XSS vector (audit F2).
          const sanitizedGames = parsed.games.map(sanitizeGame).filter(Boolean);
          const skippedCount = parsed.games.length - sanitizedGames.length;
          if (sanitizedGames.length === 0) {
            throw new Error('Invalid backup file: no usable game entries found');
          }

          const confirmMsg = skippedCount > 0
            ? `Found ${sanitizedGames.length} valid games (${skippedCount} invalid entries will be skipped). Restore this backup? This will overwrite your current database library.`
            : `Are you sure you want to restore ${sanitizedGames.length} games and settings from this backup? This will overwrite your current database library.`;
          const confirmRestore = await showConfirm({
            title: 'Restore backup?',
            message: confirmMsg,
            confirmLabel: 'Overwrite & Restore',
            cancelLabel: 'Cancel',
            danger: true
          });
          if (!confirmRestore) {
            backupFileInput.value = '';
            return;
          }

          showToast('Restoring backup to Supabase...', 'info');

          // Update appState
          appState.games = deduplicateGamesList(sanitizedGames, false);
          appState.steamId = parsed.steamId || '';
          appState.vanityUrl = parsed.vanityUrl || '';
          appState.gogUsername = parsed.gogUsername || '';
          appState.epicConnected = parsed.epicConnected || false;
          appState.legacyConnected = parsed.legacyConnected || false;
          appState.indiegalaConnected = parsed.indiegalaConnected || false;
          appState.blacklistAppIds = parsed.blacklistAppIds || [];
          appState.blacklistTitles = parsed.blacklistTitles || [];

          // Save to Supabase (forces settings update and games update)
          await saveSettingsToStorage();
          await syncGamesToSupabase(appState.games);

          // Clear local storage if any legacy exists
          localStorage.removeItem('crossplay_state');

          // Render
          emptyState.classList.add('hidden');
          renderGames();
          updateStats();
          updateStageBackground();
          
          showToast(skippedCount > 0
            ? `Library restored: ${appState.games.length} games imported, ${skippedCount} invalid entries skipped.`
            : 'Library and settings restored successfully from backup!', 'success');
        } catch (err) {
          console.error(err);
          showToast(`Restore failed: ${err.message}`, 'error');
        }
        backupFileInput.value = '';
      };
      reader.readAsText(file);
    });
  }
}

// Initialize cloud-sync state from the backend (booleans only — the browser
// never receives Supabase credentials; audit B1-A)
async function initializeSupabase() {
  try {
    const res = await fetch('/api/config/status');
    if (!res.ok) throw new Error('Failed to fetch config status');
    const data = await res.json();

    appState.supabaseConfig = {
      enabled: !!data.supabaseConfigured,
      url: '',
      anonKey: ''
    };
    updateConnectionStatusUI();
  } catch (err) {
    console.error('Failed to initialize Supabase Client:', err);
    appState.supabaseConfig.enabled = false;
    updateConnectionStatusUI();
  }
}

// Fetch app settings from Supabase
async function fetchSettingsFromSupabase() {
  if (!isCloudEnabled()) return;
  
  try {
    const payload = await dbRequest('/api/db/settings');
    const data = payload.settings; // DB row or null
    if (data) {
      appState.steamId = data.steam_id || '';
      appState.vanityUrl = data.vanity_url || '';
      appState.gogUsername = data.gog_username || '';
      appState.stoveMemberNo = data.stove_member_no || '';
      appState.itchCollectionUrl = data.itch_collection_url || '';
      appState.epicConnected = data.epic_connected || false;
      appState.legacyConnected = data.legacy_connected || false;
      appState.indiegalaConnected = data.indiegala_connected || false;
      appState.blacklistAppIds = data.blacklist_app_ids || [];
      appState.blacklistTitles = data.blacklist_titles || [];
      
      // Populate inputs with settings
      steamIdentifierInput.value = appState.vanityUrl || appState.steamId || '';
      if (appState.steamId) {
        resolvedProfileCard.classList.remove('hidden');
        resolvedName.textContent = appState.vanityUrl ? `@${appState.vanityUrl}` : 'Steam Account';
        resolvedId.textContent = `ID: ${appState.steamId}`;
      }
      
      gogUsernameInput.value = appState.gogUsername || '';
      if (appState.gogUsername) {
        resolvedGogCard.classList.remove('hidden');
        resolvedGogName.textContent = `@${appState.gogUsername}`;
        resolvedGogId.textContent = `Username: ${appState.gogUsername}`;
      }
      
      if (stoveMemberNoInput) {
        stoveMemberNoInput.value = appState.stoveMemberNo || '';
      }
      if (appState.stoveMemberNo && resolvedStoveCard) {
        resolvedStoveCard.classList.remove('hidden');
        if (resolvedStoveName) resolvedStoveName.textContent = 'STOVE Account';
        if (resolvedStoveId) resolvedStoveId.textContent = `Member ID: ${appState.stoveMemberNo}`;
      }

      if (itchCollectionUrlInput) {
        itchCollectionUrlInput.value = appState.itchCollectionUrl || '';
      }
      if (appState.itchCollectionUrl && resolvedItchCard) {
        resolvedItchCard.classList.remove('hidden');
        if (resolvedItchName) resolvedItchName.textContent = 'Itch.io Collection';
        if (resolvedItchId) resolvedItchId.textContent = 'Collection: Connected';
      } else if (resolvedItchCard) {
        resolvedItchCard.classList.add('hidden');
      }
      
      if (appState.epicConnected && resolvedEpicCard) {
        resolvedEpicCard.classList.remove('hidden');
      } else if (resolvedEpicCard) {
        resolvedEpicCard.classList.add('hidden');
      }

      if (appState.legacyConnected && resolvedLegacyCard) {
        resolvedLegacyCard.classList.remove('hidden');
      } else if (resolvedLegacyCard) {
        resolvedLegacyCard.classList.add('hidden');
      }

      if (appState.indiegalaConnected && resolvedIndiegalaCard) {
        resolvedIndiegalaCard.classList.remove('hidden');
      } else if (resolvedIndiegalaCard) {
        resolvedIndiegalaCard.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Error fetching settings from Supabase:', err);
    showToast('Failed to load settings from Supabase database', 'error');
  }
}

// Update Database Connection status text and dots
function updateConnectionStatusUI() {
  if (isCloudEnabled()) {
    connectionStatus.classList.remove('offline');
    connectionStatus.classList.add('online');
    connectionText.textContent = 'Supabase Connected';
    
    // Update settings tab status UI
    if (supabaseStatusText && supabaseStatusBadge && supabaseStatusIcon && supabaseStatusAvatar) {
      supabaseStatusText.textContent = 'Connected to cloud database.';
      supabaseStatusBadge.textContent = 'Active';
      supabaseStatusBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
      supabaseStatusBadge.style.color = '#10b981';
      supabaseStatusBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      supabaseStatusIcon.setAttribute('data-lucide', 'cloud-lightning');
      supabaseStatusAvatar.style.color = '#10b981';
      supabaseStatusAvatar.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
      supabaseStatusAvatar.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    }
  } else {
    connectionStatus.classList.remove('online');
    connectionStatus.classList.add('offline');
    connectionText.textContent = 'Database Offline';
    
    // Update settings tab status UI
    if (supabaseStatusText && supabaseStatusBadge && supabaseStatusIcon && supabaseStatusAvatar) {
      supabaseStatusText.textContent = 'Not configured or unable to connect. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.';
      supabaseStatusBadge.textContent = 'Offline';
      supabaseStatusBadge.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
      supabaseStatusBadge.style.color = '#ef4444';
      supabaseStatusBadge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      supabaseStatusIcon.setAttribute('data-lucide', 'cloud-off');
      supabaseStatusAvatar.style.color = '#ef4444';
      supabaseStatusAvatar.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
      supabaseStatusAvatar.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    }
  }
  lucide.createIcons();
}

// Check if Twitch/IGDB API credentials are configured in local .env
async function checkIgdbStatus() {
  try {
    const res = await fetch('/api/config/status');
    if (res.ok) {
      const data = await res.json();
      const statusText = document.getElementById('igdb-env-text');
      const statusBadge = document.getElementById('igdb-status-badge');
      const statusIcon = document.getElementById('igdb-status-icon');
      const statusAvatar = document.getElementById('igdb-status-avatar');

      if (data.twitchConfigured) {
        statusText.textContent = 'Twitch credentials detected in .env file.';
        statusBadge.textContent = 'Active';
        statusBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
        statusBadge.style.color = '#10b981';
        statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        statusIcon.setAttribute('data-lucide', 'shield-check');
        statusAvatar.style.color = '#10b981';
        statusAvatar.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        statusAvatar.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      } else {
        statusText.textContent = 'Twitch credentials not set. IGDB fallback & search is disabled.';
        statusBadge.textContent = 'Offline';
        statusBadge.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        statusBadge.style.color = '#ef4444';
        statusBadge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        statusIcon.setAttribute('data-lucide', 'shield-alert');
        statusAvatar.style.color = '#ef4444';
        statusAvatar.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        statusAvatar.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      }
      lucide.createIcons();
    }
  } catch (err) {
    console.error('Failed to check IGDB status:', err);
  }
}

// Fetch Games from Supabase (via backend proxy)
async function fetchGamesFromSupabase() {
  if (!isCloudEnabled()) return;
  
  try {
    const payload = await dbRequest('/api/db/games');
    const data = payload.games;
    
    if (data && data.length > 0) {
      const parsedGames = data.map(item => ({
        external_id: item.external_id,
        platform: item.platform,
        appid: item.platform === 'Steam' ? Number(item.external_id) : item.external_id,
        name: item.title,
        playtime_forever: item.playtime_forever,
        rtime_last_played: item.last_played ? Math.floor(new Date(item.last_played).getTime() / 1000) : 0,
        cover_url: item.cover_url,
        backdrop_url: item.backdrop_url || null
      }));
      
      // Deduplicate loaded games and clean up any old redundant duplicate rows in Supabase
      appState.games = deduplicateGamesList(parsedGames, true);
      
      saveSettingsToStorage();
      emptyState.classList.add('hidden');
      renderGames();
      updateStats();
    } else {
      // Database has no games. If we have games in appState (loaded from localStorage), migrate them to Supabase!
      if (appState.games && appState.games.length > 0) {
        showToast('Migrating local storage data to Supabase...', 'info');
        await saveSettingsToStorage(); // Saves settings to Supabase settings table
        await syncGamesToSupabase(appState.games); // Syncs games to Supabase games table
        localStorage.removeItem('crossplay_state'); // Clear local storage completely after migration
      }
    }
  } catch (err) {
    console.error('Error fetching from Supabase:', err);
    showToast('Failed to load games from Supabase cloud database', 'error');
  }
}

// Asynchronously verify Steam backdrop URLs and fall back to IGDB if Steam library_hero.jpg returns 404
async function verifyAndFixSteamBackdrops(gamesToVerify) {
  let fixedCount = 0;
  for (const game of gamesToVerify) {
    if (game.backdrop_url) {
      const isValid = await isImageValid(game.backdrop_url);
      if (!isValid) {
        try {
          const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.backdrop_url && await isImageValid(data.backdrop_url)) {
              game.backdrop_url = data.backdrop_url;
              fixedCount++;
              if (isCloudEnabled()) {
                if (isCloudEnabled()) {
                  await dbUpsertGames([toDbRow(game)]);
                }
              }
            }
          }
        } catch (e) {
          console.warn(`IGDB backdrop fallback failed for ${game.name}:`, e);
        }
      }
    }
  }

  if (fixedCount > 0) {
    saveSettingsToStorage();
    renderGames();
    updateStageBackground();
    console.log(`Resolved IGDB backdrops for ${fixedCount} Steam games with 404 hero images.`);
  }
}

// Sync Steam Library
async function syncSteamLibraryCore() {
  try {
    const response = await fetch(`/api/steam/games?steamId=${appState.steamId}`);
    if (!response.ok) {
      throw new Error(`Server returned error status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.response || !data.response.games) {
      throw new Error('No games returned. Make sure your Steam Profile is Public.');
    }
    
    // Check existing Steam games in appState to preserve manually edited artwork
    const existingSteamMap = new Map();
    appState.games.filter(g => g.platform === 'Steam').forEach(g => {
      existingSteamMap.set(String(g.external_id), g);
    });

    const steamGames = data.response.games;

    const newSteamGames = steamGames
      .filter(game => !shouldExcludeGame(game.name, game.appid))
      .map(game => {
        const appid = game.appid;
        const defaultCoverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
        const defaultBackdropUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`;
        const extId = String(game.appid);
        const existing = existingSteamMap.get(extId);

        return {
          external_id: extId,
          platform: 'Steam',
          appid: game.appid,
          name: game.name,
          playtime_forever: game.playtime_forever,
          rtime_last_played: game.rtime_last_played || 0,
          cover_url: (existing && existing.cover_url) ? existing.cover_url : defaultCoverUrl,
          backdrop_url: (existing && existing.backdrop_url) ? existing.backdrop_url : defaultBackdropUrl
        };
      });

    appState.games = [
      ...appState.games.filter(g => g.platform !== 'Steam'),
      ...newSteamGames
    ];
    // Dedupe at mutation time so renderGames doesn't have to on every keystroke (audit F10.1)
    appState.games = deduplicateGamesList(appState.games, false);

    saveSettingsToStorage();
    
    if (isCloudEnabled()) {
      showToast('Syncing Steam library with Supabase...', 'info');
      await syncGamesToSupabase(appState.games);
    }
    
    renderGames();
    updateStats();
    showToast(`Successfully synced ${newSteamGames.length} Steam games!`, 'success');

    // Asynchronously check for 404 Steam hero backdrops and fallback to IGDB
    verifyAndFixSteamBackdrops(newSteamGames).catch(console.error);

  } catch (err) {
    console.error(err);
    showToast(`Steam Sync failed: ${err.message}`, 'error');
  }
}

// Sync GOG Library (Public profile stats sync)
async function syncGogLibraryCore() {
  try {
    const response = await fetch(`/api/gog/games?username=${encodeURIComponent(appState.gogUsername)}`);
    if (!response.ok) {
      throw new Error(`Server returned error status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.games) {
      throw new Error('No games returned. GOG profile might be private.');
    }
    
    const gogGames = data.games;
    if (data.truncated) {
      showToast(`GOG library is very large — only the first ${gogGames.length} games were synced (server page limit).`, 'warning');
    }
    
    // Check existing GOG games in appState to preserve already-upgraded artwork
    const existingGogMap = new Map();
    appState.games.filter(g => g.platform === 'GOG').forEach(g => {
      existingGogMap.set(String(g.external_id), g);
    });

    const newGogGames = gogGames
      .filter(game => !shouldExcludeGame(game.name, game.appid))
      .map(game => {
        let cover = game.cover_url || '';
        if (cover.startsWith('//')) {
          cover = 'https:' + cover;
        }
        const extId = String(game.appid);
        const existing = existingGogMap.get(extId);

        return {
          external_id: extId,
          platform: 'GOG',
          appid: game.appid,
          name: game.name,
          playtime_forever: game.playtime_forever,
          rtime_last_played: 0,
          cover_url: (existing && existing.cover_url) ? existing.cover_url : cover,
          backdrop_url: (existing && existing.backdrop_url) ? existing.backdrop_url : null
        };
      });

    // Automatically resolve vertical covers & landscape backdrops via Steam/IGDB search
    const gogBatchSize = 10;
    for (let i = 0; i < newGogGames.length; i += gogBatchSize) {
      const batch = newGogGames.slice(i, i + gogBatchSize);
      await Promise.all(batch.map(async game => {
        try {
          const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
          if (res.ok) {
            const coverData = await res.json();
            if (coverData.backdrop_url && !game.backdrop_url) {
              game.backdrop_url = coverData.backdrop_url;
            }
            if (coverData.cover_url && !game.cover_url) {
              game.cover_url = coverData.cover_url;
            }
          }
        } catch (e) {
          console.error(`Failed to resolve artwork for ${game.name}:`, e);
        }
      }));
    }

    appState.games = [
      ...appState.games.filter(g => g.platform !== 'GOG'),
      ...newGogGames
    ];
    // Dedupe at mutation time so renderGames doesn't have to on every keystroke (audit F10.1)
    appState.games = deduplicateGamesList(appState.games, false);

    saveSettingsToStorage();
    
    if (isCloudEnabled()) {
      showToast('Syncing GOG library with Supabase...', 'info');
      await syncGamesToSupabase(appState.games);
    }
    
    renderGames();
    updateStats();
    showToast(`Successfully synced ${newGogGames.length} GOG games!`, 'success');

  } catch (err) {
    console.error(err);
    showToast(`GOG Sync failed: ${err.message}`, 'error');
  }
}

// Sync STOVE Library
async function syncStoveLibraryCore() {
  try {
    const response = await fetch(`/api/stove/games?memberNo=${encodeURIComponent(appState.stoveMemberNo)}`);
    if (!response.ok) {
      let errMsg = `Server returned error status: ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) errMsg = errJson.error;
      } catch (e) {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    if (!data.games) {
      throw new Error('No games returned. STOVE profile might be private.');
    }

    const existingStoveMap = new Map();
    appState.games.filter(g => g.platform === 'Stove').forEach(g => {
      existingStoveMap.set(String(g.external_id), g);
    });

    const stoveGames = data.games;
    if (data.truncated) {
      showToast(`STOVE library is very large — only the first ${stoveGames.length} games were synced (server page limit).`, 'warning');
    }
    const newStoveGames = stoveGames
      .filter(game => !shouldExcludeGame(game.name, game.appid))
      .map(game => {
        let cover = game.cover_url || '';
        if (cover.startsWith('//')) {
          cover = 'https:' + cover;
        }
        const extId = String(game.appid);
        const existing = existingStoveMap.get(extId);

        return {
          external_id: extId,
          platform: 'Stove',
          appid: game.appid,
          name: game.name,
          playtime_forever: game.playtime_forever || 0,
          rtime_last_played: game.rtime_last_played || 0,
          cover_url: (existing && existing.cover_url) ? existing.cover_url : cover,
          backdrop_url: (existing && existing.backdrop_url) ? existing.backdrop_url : null
        };
      });

    // Resolve landscape backdrop artwork via search-cover if no native hero
    const stoveBatchSize = 10;
    for (let i = 0; i < newStoveGames.length; i += stoveBatchSize) {
      const batch = newStoveGames.slice(i, i + stoveBatchSize);
      await Promise.all(batch.map(async game => {
        try {
          const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
          if (res.ok) {
            const coverData = await res.json();
            if (coverData.backdrop_url && !game.backdrop_url) {
              game.backdrop_url = coverData.backdrop_url;
            }
            if (!game.cover_url && coverData.cover_url) {
              game.cover_url = coverData.cover_url;
            }
          }
        } catch (e) {
          console.error(`Failed to resolve artwork for ${game.name}:`, e);
        }
      }));
    }

    appState.games = [
      ...appState.games.filter(g => g.platform !== 'Stove'),
      ...newStoveGames
    ];
    // Dedupe at mutation time so renderGames doesn't have to on every keystroke (audit F10.1)
    appState.games = deduplicateGamesList(appState.games, false);

    saveSettingsToStorage();

    if (isCloudEnabled()) {
      showToast('Syncing STOVE library with Supabase...', 'info');
      await syncGamesToSupabase(appState.games);
    }

    renderGames();
    updateStats();
    if (newStoveGames.length === 0) {
      showToast('STOVE sync complete: 0 games found. (Verify your STOVE account owns games and library is Public)', 'info');
    } else {
      showToast(`Successfully synced ${newStoveGames.length} STOVE games!`, 'success');
    }

  } catch (err) {
    console.error(err);
    showToast(`STOVE Sync failed: ${err.message}`, 'error');
  }
}

// Sync Itch.io Library (Public collection scraper sync)
async function syncItchLibraryCore() {
  try {
    const response = await fetch(`/api/itch/games?collectionUrl=${encodeURIComponent(appState.itchCollectionUrl)}`);
    if (!response.ok) {
      let errMsg = `Server returned error status: ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson && errJson.error) errMsg = errJson.error;
      } catch (e) {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    if (!data.games) {
      throw new Error('No games returned. Collection might be empty or private.');
    }

    const collectionGames = data.games;

    // Filter existing Itch.io games in library (checking platform case-insensitively)
    const existingItchGames = appState.games.filter(g => {
      const p = (g.platform || '').toLowerCase();
      return p === 'itch.io' || p === 'itch';
    });

    // Build lookup maps for existing Itch.io games
    const existingItchIdMap = new Map();
    const existingItchTitleMap = new Map();

    existingItchGames.forEach(g => {
      if (g.external_id) existingItchIdMap.set(String(g.external_id).toLowerCase(), g);
      if (g.appid) existingItchIdMap.set(String(g.appid).toLowerCase(), g);
      const stem = stemTitle(g.name || g.title);
      if (stem) existingItchTitleMap.set(stem, g);
    });

    const matchedExistingExtIds = new Set();

    const newItchGames = collectionGames
      .filter(game => !shouldExcludeGame(game.name, game.appid))
      .map(game => {
        let cover = game.cover_url || '';
        if (cover.startsWith('//')) {
          cover = 'https:' + cover;
        }
        const extId = String(game.appid);
        const stem = stemTitle(game.name);

        // Find existing match by ID or Stemmed Title (e.g. Lord of Chaos <-> Lords of Chaos)
        const existing = existingItchIdMap.get(extId.toLowerCase()) || existingItchTitleMap.get(stem);

        if (existing) {
          if (existing.external_id) matchedExistingExtIds.add(String(existing.external_id));
        }

        return {
          external_id: extId,
          platform: 'Itch.io',
          appid: game.appid,
          name: game.name,
          // PRESERVE user's existing playtime and last played dates
          playtime_forever: (existing && existing.playtime_forever !== undefined && existing.playtime_forever !== null) ? existing.playtime_forever : 0,
          rtime_last_played: (existing && existing.rtime_last_played !== undefined && existing.rtime_last_played !== null) ? existing.rtime_last_played : 0,
          // PRESERVE user's existing cover and backdrop artwork if they already exist
          cover_url: (existing && existing.cover_url) ? existing.cover_url : (cover || null),
          backdrop_url: (existing && existing.backdrop_url) ? existing.backdrop_url : null
        };
      });

    // Preserve any existing manual Itch.io games that were not matched to this collection
    const preservedManualGames = existingItchGames.filter(g => {
      const extStr = String(g.external_id || '');
      const isMatched = matchedExistingExtIds.has(extStr);
      return !isMatched && (extStr.startsWith('manual_') || !collectionGames.some(cg => normalizeGameTitle(cg.name) === normalizeGameTitle(g.name)));
    });

    // Resolve landscape backdrop / vertical poster via search-cover if missing
    const itchBatchSize = 10;
    for (let i = 0; i < newItchGames.length; i += itchBatchSize) {
      const batch = newItchGames.slice(i, i + itchBatchSize);
      await Promise.all(batch.map(async game => {
        if (!game.backdrop_url || !game.cover_url) {
          try {
            const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
            if (res.ok) {
              const coverData = await res.json();
              if (coverData.backdrop_url && !game.backdrop_url) {
                game.backdrop_url = coverData.backdrop_url;
              }
              if (!game.cover_url && coverData.cover_url) {
                game.cover_url = coverData.cover_url;
              }
            }
          } catch (e) {
            console.error(`Failed to resolve artwork for ${game.name}:`, e);
          }
        }
      }));
    }

    const cleanItchList = deduplicateGamesList(newItchGames, false);

    // Delete any old manual_... rows from Supabase so they don't linger in DB
    if (isCloudEnabled()) {
      const oldManualIds = existingItchGames
        .filter(g => String(g.external_id || '').startsWith('manual_'))
        .map(g => String(g.external_id));

      if (oldManualIds.length > 0) {
        console.log('[CrossPlay Itch Sync] Deleting obsolete manual entries from Supabase:', oldManualIds);
        try {
          await dbDeleteGamesByPlatformIds('Itch.io', oldManualIds);
        } catch (err) {
          console.warn('Failed to delete obsolete manual rows from Supabase:', err);
        }
      }
    }

    // Merge: Replace Itch games with the exact synced collection (preserving all other platforms)
    appState.games = deduplicateGamesList([
      ...appState.games.filter(g => {
        const p = (g.platform || '').toLowerCase();
        return p !== 'itch.io' && p !== 'itch';
      }),
      ...cleanItchList
    ], true);

    saveSettingsToStorage();

    if (isCloudEnabled()) {
      showToast('Syncing Itch.io library with Supabase...', 'info');
      await syncGamesToSupabase(appState.games);
    }

    renderGames();
    updateStats();
    if (cleanItchList.length === 0) {
      showToast('Itch.io sync complete: 0 games found. (Verify collection URL and public status)', 'info');
    } else {
      showToast(`Successfully synced ${cleanItchList.length} Itch.io games!`, 'success');
    }

  } catch (err) {
    console.error(err);
    showToast(`Itch.io Sync failed: ${err.message}`, 'error');
  }
}

// Orchestrate a sync of one or all configured platforms from the merged button / dropdown
async function triggerSync(platforms) {
  // Normalize platform names to correct casing ('Steam', 'GOG', 'Stove', 'Itch')
  platforms = platforms.map(p => {
    const lower = p.toLowerCase();
    if (lower === 'steam') return 'Steam';
    if (lower === 'gog') return 'GOG';
    if (lower === 'stove') return 'Stove';
    if (lower === 'itch' || lower === 'itch.io') return 'Itch';
    return p;
  });

  if (platforms.includes('Steam') && !appState.steamId) {
    showToast('Please configure your Steam ID in Settings first!', 'info');
    showPage('settings');
    return;
  }
  if (platforms.includes('GOG') && !appState.gogUsername) {
    showToast('Please configure your GOG username in Settings first!', 'info');
    showPage('settings');
    return;
  }
  if (platforms.includes('Stove') && !appState.stoveMemberNo) {
    showToast('Please configure your STOVE Member ID in Settings first!', 'info');
    showPage('settings');
    return;
  }
  if (platforms.includes('Itch') && !appState.itchCollectionUrl) {
    showToast('Please configure your Itch.io Collection URL in Settings first!', 'info');
    showPage('settings');
    return;
  }

  if (syncInProgress) {
    showToast(SYNC_BUSY_MESSAGE, 'info');
    return;
  }
  syncInProgress = true;

  // Visual feedback on the merged button
  try {
    if (syncAllBtn) {
      syncAllBtn.disabled = true;
      syncAllBtn.classList.add('is-syncing');
    }
    if (syncDropdownToggle) syncDropdownToggle.disabled = true;
    if (syncAllIcon) syncAllIcon.classList.add('syncing-rotate');
    loadingText.textContent = `Syncing ${platforms.join(' & ')} Library...`;
    loadingSpinner.setAttribute('aria-busy', 'true');
    loadingSpinner.classList.remove('hidden');
    gamesGrid.setAttribute('aria-busy', 'true');
    gamesGrid.classList.add('hidden');
    emptyState.classList.add('hidden');

    const tasks = [];
    if (platforms.includes('Steam') && appState.steamId) tasks.push(syncSteamLibraryCore());
    if (platforms.includes('GOG') && appState.gogUsername) tasks.push(syncGogLibraryCore());
    if (platforms.includes('Stove') && appState.stoveMemberNo) tasks.push(syncStoveLibraryCore());
    if (platforms.includes('Itch') && appState.itchCollectionUrl) tasks.push(syncItchLibraryCore());

    await Promise.allSettled(tasks);
  } finally {
    syncInProgress = false;

    loadingSpinner.setAttribute('aria-busy', 'false');
    loadingSpinner.classList.add('hidden');
    gamesGrid.removeAttribute('aria-busy');
    gamesGrid.classList.remove('hidden');
    if (syncAllBtn) {
      syncAllBtn.disabled = false;
      syncAllBtn.classList.remove('is-syncing');
      syncAllBtn.classList.add('sync-success');
      setTimeout(() => {
        syncAllBtn.classList.remove('sync-success');
      }, 1800);
    }
    if (syncDropdownToggle) syncDropdownToggle.disabled = false;
    if (syncAllIcon) syncAllIcon.classList.remove('syncing-rotate');

    if (appState.games.length === 0) {
      emptyState.classList.remove('hidden');
    }
  }
}

// Push local games to Supabase using unified structure (via backend proxy)
async function syncGamesToSupabase(gamesList) {
  if (!isCloudEnabled()) return;

  try {
    const deduplicated = deduplicateGamesList(gamesList, false);
    const rows = deduplicated.map(toDbRow);

    await dbUpsertGames(rows);
    showToast('Supabase database sync completed!', 'success');
  } catch (err) {
    console.error('Supabase Sync error:', err);
    showToast(`Supabase sync failed: ${err.message}`, 'error');
  }
}

// Get platform badge HTML (including official SVGs for major stores)
function getPlatformBadgeHtml(platform) {
  const p = platform ? platform.toLowerCase() : '';
  let iconHtml = '';
  let platformClass = 'other';
  
  if (p === 'steam') {
    platformClass = 'steam';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
    </svg>`;
  } else if (p === 'gog') {
    platformClass = 'gog';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.15 15.24H4.36a.4.4 0 0 0-.4.4v2c0 .21.18.4.4.4h2.8v1.32h-3.5c-.56 0-1.02-.46-1.02-1.03v-3.39c0-.56.46-1.02 1.03-1.02h3.48v1.32zM8.16 11.54c0 .58-.47 1.05-1.05 1.05H2.63v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4H4.39a.4.4 0 0 0-.41.4v2.02c0 .23.18.4.4.4H6v1.35H3.68c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04H7.1c.58 0 1.05.47 1.05 1.04v5.86zM21.36 19.36h-1.32v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.42c0-.56.46-1.02 1.03-1.02h5.61v5.44zM21.37 11.54c0 .58-.47 1.05-1.05 1.05h-4.48v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4h-2.03a.4.4 0 0 0-.4.4v2.02c0 .23.18.4.4.4h1.62v1.35H16.9c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04h3.43c.58 0 1.05.47 1.05 1.04v5.86zM13.72 4.64h-3.44c-.58 0-1.04.47-1.04 1.04v3.44c0 .58.46 1.04 1.04 1.04h3.44c.57 0 1.04-.46 1.04-1.04V5.68c0-.57-.47-1.04-1.04-1.04m-.3 1.75v2.02a.4.4 0 0 1-.4.4h-2.03a.4.4 0 0 1-.4-.4V6.4c0-.22.17-.4.4-.4H13c.23 0 .4.18.4.4zM12.63 13.92H9.24c-.57 0-1.03.46-1.03 1.02v3.39c0 .57.46 1.03 1.03 1.03h3.39c.57 0 1.03-.46 1.03-1.03v-3.39c0-.56-.46-1.02-1.03-1.02m-.3 1.72v2a.4.4 0 0 1-.4.4v-.01H9.94a.4.4 0 0 1-.4-.4v-1.99c0-.22.18-.4.4-.4h2c.22 0 .4.18.4.4zM23.49 1.1a1.74 1.74 0 0 0-1.24-.52H1.75A1.74 1.74 0 0 0 0 2.33v19.34a1.74 1.74 0 0 0 1.75 1.75h20.5A1.74 1.74 0 0 0 24 21.67V2.33c0-.48-.2-.92-.51-1.24m0 20.58a1.23 1.23 0 0 1-1.24 1.24H1.75A1.23 1.23 0 0 1 .5 21.67V2.33a1.23 1.23 0 0 1 1.24-1.24h20.5a1.24 1.24 0 0 1 1.24 1.24v19.34z"/>
    </svg>`;
  } else if (p === 'epic') {
    platformClass = 'epic';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 00.02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 00.02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.708 1.708 0 01.591.108 1.745 1.745 0 01.49.299l-.452.546a1.247 1.247 0 00-.308-.195.91.91 0 00-.363-.068.658.658 0 00-.28.06.703.703 0 00-.224.163.783.783 0 00-.151.243.799.799 0 00-.056.299v.008a.852.852 0 00.056.31.7.7 0 00.157.245.736.736 0 00.238.16.774.774 0 00.303.058.79.79 0 00.445-.116v-.339h-.548v-.565H7.37v1.255a2.019 2.019 0 01-.524.307 1.789 1.789 0 01-.683.123 1.642 1.642 0 01-.602-.107 1.46 1.46 0 01-.478-.3 1.371 1.371 0 01-.318-.455 1.438 1.438 0 01-.115-.58v-.008a1.426 1.426 0 01.113-.57 1.449 1.449 0 01.312-.46 1.418 1.418 0 01.474-.309 1.58 1.58 0 01.598-.111 1.708 1.708 0 01.045 0zm11.963.008a2.006 2.006 0 01.612.094 1.61 1.61 0 01.507.277l-.386.546a1.562 1.562 0 00-.39-.205 1.178 1.178 0 00-.388-.07.347.347 0 00-.208.052.154.154 0 00-.07.127v.008a.158.158 0 00.022.084.198.198 0 00.076.066.831.831 0 00.147.06c.062.02.14.04.236.061a3.389 3.389 0 01.43.122 1.292 1.292 0 01.328.17.678.678 0 01.207.24.739.739 0 01.071.337v.008a.865.865 0 01-.081.382.82.82 0 01-.229.285 1.032 1.032 0 01-.353.18 1.606 1.606 0 01-.46.061 2.16 2.16 0 01-.71-.116 1.718 1.718 0 01-.593-.346l.43-.514c.277.223.578.335.9.335a.457.457 0 00.236-.05.157.157 0 00.082-.142v-.008a.15.15 0 00-.02-.077.204.204 0 00-.073-.066.753.753 0 00-.143-.062 2.45 2.45 0 00-.233-.062 5.036 5.036 0 01-.413-.113 1.26 1.26 0 01-.331-.16.72.72 0 01-.222-.243.73.73 0 01-.082-.36v-.008a.863.863 0 01.074-.359.794.794 0 01.214-.283 1.007 1.007 0 01.34-.185 1.423 1.423 0 01.448-.066 2.006 2.006 0 01.025 0zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z"/>
    </svg>`;
  } else if (p === 'itch.io' || p === 'itch') {
    platformClass = 'itch';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2.682 3.003C1.81 3.003.953 3.633.953 4.887v.64c0 1.258.91 2.33 2.128 2.502l.628.09a.573.573 0 0 1 .494.567v3.295c0 4.19 3.02 7.747 7.15 8.358.337.05.674.075 1.011.075.336 0 .673-.025 1.01-.075 4.131-.611 7.152-4.168 7.152-8.358V8.686a.573.573 0 0 1 .493-.567l.63-.09c1.217-.172 2.126-1.244 2.126-2.502v-.64c0-1.254-.856-1.884-1.728-1.884H2.682zm4.12 5.093a1.442 1.442 0 1 1 0 2.884 1.442 1.442 0 0 1 0-2.884zm10.395 0a1.442 1.442 0 1 1 0 2.884 1.442 1.442 0 0 1 0-2.884zM9.54 14.808h4.92c.494 0 .894.4.894.895 0 .494-.4.894-.895.894H9.54a.895.895 0 0 1-.895-.894c0-.495.4-.895.895-.895z"/>
    </svg>`;
  } else if (p === 'stove') {
    platformClass = 'stove';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm-.8 15.3c-2.4 0-4.2-1.4-4.2-3.8 0-3.3 4.8-4.1 4.8-5.7 0-.5-.4-.9-1.2-.9-1 0-2.1.4-3 1l-1-1.6c1.2-.9 2.7-1.4 4.3-1.4 2.3 0 4 1.3 4 3.7 0 3.5-4.8 4.2-4.8 5.7 0 .6.5 1 1.3 1 1.2 0 2.4-.6 3.4-1.3l1 1.6c-1.3 1.1-2.9 1.7-4.6 1.7z"/>
    </svg>`;
  } else if (p === 'ubisoft' || p === 'uplay' || p.includes('ubisoft')) {
    platformClass = 'ubisoft';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.372 0 0 5.372 0 12c0 6.627 5.372 12 12 12s12-5.373 12-12c0-6.628-5.372-12-12-12zm6.98 12.357c-.12 3.65-2.97 6.64-6.62 6.87-3.99.25-7.39-2.85-7.39-6.84 0-3.69 2.93-6.73 6.62-6.87 2.14-.08 4.14.79 5.54 2.3l-1.63 1.63c-1-1.09-2.42-1.71-3.91-1.65-2.6.1-4.7 2.21-4.7 4.81 0 2.65 2.15 4.8 4.8 4.8 2.5 0 4.56-1.92 4.77-4.39h-4.77v-2.28h7.29c.07.54.1 1.07.1 1.62z"/>
    </svg>`;
  } else if (p === 'indiegala' || p === 'gala' || p.includes('indiegala')) {
    platformClass = 'indiegala';
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.284 0c-.394 0-.714.32-.714.714v16.143l3.57 3.571V.714C9.14.32 8.82 0 8.426 0H6.284zm5.714 3.571c-.394 0-.714.32-.714.715v16.143l3.572 3.571V4.286c0-.394-.32-.715-.715-.715h-2.143zm5.716 3.572c-.394 0-.714.32-.714.714v16.143L20.57 24V7.857c0-.394-.32-.714-.714-.714h-2.142zM.57 7.143C.256 7.143 0 7.4 0 7.714v9.143l3.429 3.429V7.714c0-.315-.256-.571-.571-.571H.57z"/>
    </svg>`;
  } else {
    // For others (Legacy, Amazon Gaming, Microsoft Store, Custom, etc.) show official joystick SVG
    platformClass = p.includes('legacy') ? 'legacy' : (p.includes('amazon') ? 'amazon' : (p.includes('microsoft') ? 'microsoft' : (p.includes('itch') ? 'itch' : (p.includes('stove') ? 'stove' : (p.includes('ubisoft') ? 'ubisoft' : (p.includes('indiegala') ? 'indiegala' : 'other'))))));
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2Z"/>
      <path d="M6 15v-2"/>
      <path d="M12 15V9"/>
      <circle cx="12" cy="5" r="3"/>
    </svg>`;
  }
  
  return `<span class="card-badge platform-badge ${platformClass}" title="${escapeHtml(platform || '')}">
    ${iconHtml}
  </span>`;
}

// Render Games Grid
// NOTE: deduplication intentionally happens at mutation points (sync/import/
// restore), not on every keystroke-driven render — audit F10.1.
function renderGames(shouldUpdateStats = true) {

  if (shouldUpdateStats) {
    updateStats();
  }
  gamesGrid.innerHTML = '';
  
  if (appState.games.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  // Filter games
  let filteredGames = appState.games.filter(game => {
    const matchesSearch = game.name.toLowerCase().includes(appState.searchQuery);
    
    let matchesTab = true;
    if (appState.filters !== 'all') {
      if (appState.filters === 'other') {
        const knownPlatforms = ['Steam', 'GOG', 'Epic', 'Legacy', 'Amazon Gaming', 'Microsoft Store', 'Luna', 'Itch.io', 'itch.io', 'Stove', 'Ubisoft', 'IndieGala'];
        matchesTab = !knownPlatforms.includes(game.platform) && game.platform?.toLowerCase() !== 'itch.io';
      } else if (appState.filters === 'Luna') {
        matchesTab = game.platform === 'Luna' || game.platform === 'Amazon Gaming';
      } else if (appState.filters === 'Itch.io') {
        matchesTab = game.platform === 'Itch.io' || game.platform?.toLowerCase() === 'itch.io';
      } else {
        matchesTab = game.platform === appState.filters;
      }
    }
    
    return matchesSearch && matchesTab;
  });

  // Helper to strip leading articles ('The ', 'A ', 'An ') for Steam-style alphabetical sorting
  const getSortableName = (name) => {
    if (!name) return '';
    return name.replace(/^(the|a|an)\s+/i, '').trim();
  };

  // Sort games
  filteredGames.sort((a, b) => {
    if (appState.sortKey === 'playtime-desc') {
      const diff = b.playtime_forever - a.playtime_forever;
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    } else if (appState.sortKey === 'playtime-asc') {
      const diff = a.playtime_forever - b.playtime_forever;
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    } else if (appState.sortKey === 'lastplayed-desc') {
      const diff = (b.rtime_last_played || 0) - (a.rtime_last_played || 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    } else if (appState.sortKey === 'name-asc') {
      const sortA = getSortableName(a.name);
      const sortB = getSortableName(b.name);
      const comp = sortA.localeCompare(sortB, undefined, { sensitivity: 'base', numeric: true });
      return comp !== 0 ? comp : a.name.localeCompare(b.name);
    } else if (appState.sortKey === 'name-desc') {
      const sortA = getSortableName(a.name);
      const sortB = getSortableName(b.name);
      const comp = sortB.localeCompare(sortA, undefined, { sensitivity: 'base', numeric: true });
      return comp !== 0 ? comp : b.name.localeCompare(a.name);
    }
    return 0;
  });

  if (filteredGames.length === 0) {
    gamesGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; width: 100%;">
        <i data-lucide="search-x" class="empty-icon"></i>
        <h3>No matching games found</h3>
        <p>Try refining your search term or active filters.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const fragment = document.createDocumentFragment();

  filteredGames.forEach((game, index) => {
    const card = document.createElement('div');
    card.className = 'game-card';
    const stagger = (index % 24);
    const jitter = (index * 7) % 5;
    card.style.setProperty('--card-index', String(stagger));
    card.style.setProperty('--card-jitter', `${jitter}ms`);
    
    const playtimeHours = (game.playtime_forever / 60).toFixed(1);
    const lastPlayedText = game.rtime_last_played 
      ? new Date(game.rtime_last_played * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : 'Never';

    // Format playtime display
    const playtimeText = game.playtime_forever > 0 
      ? `${playtimeHours} hrs`
      : 'Unplayed';

    const platformBadgeHtml = getPlatformBadgeHtml(game.platform);
    const coverPath = game.cover_url || '';
    
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${game.name} — ${game.platform}`);
    card.setAttribute('data-platform', game.platform);
    card.setAttribute('data-external-id', String(game.external_id));
    card.innerHTML = `
      <div class="game-cover-container">
        <div class="card-glare" aria-hidden="true"></div>
        ${platformBadgeHtml}
        <button class="edit-cover-btn" type="button" title="Edit Cover Art" aria-label="Edit ${escapeHtml(game.name)}" data-platform="${escapeHtml(game.platform)}" data-external-id="${escapeHtml(game.external_id)}">
          <i data-lucide="edit-3" aria-hidden="true"></i>
        </button>
        <button class="delete-game-btn" type="button" title="Delete & Ignore Game" aria-label="Delete ${escapeHtml(game.name)}" data-platform="${escapeHtml(game.platform)}" data-external-id="${escapeHtml(game.external_id)}" data-name="${escapeHtml(game.name)}">
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
        ${coverPath ? 
          `<img class="game-cover" 
                src="${safeArtUrl(coverPath)}" 
                alt="${escapeHtml(game.name)}" 
                loading="lazy">`
          :
          `<div class="cover-placeholder ${escapeHtml(game.platform.toLowerCase())}">
             <i data-lucide="gamepad" class="placeholder-icon"></i>
             <div class="placeholder-title">${escapeHtml(game.name)}</div>
           </div>`
        }
      </div>
      <div class="game-card-info">
        <h4 class="game-title" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h4>
        <div class="game-meta">
          <span class="meta-item last-played" title="Last Played: ${lastPlayedText}">
            <i data-lucide="calendar"></i>
            <span>${lastPlayedText}</span>
          </span>
          <span class="meta-item playtime" title="Playtime: ${playtimeText}">
            <i data-lucide="clock"></i>
            <span>${playtimeText}</span>
          </span>
        </div>
      </div>
    `;
    
    const coverImg = card.querySelector('.game-cover');
    if (coverImg) {
      coverImg.addEventListener('error', () => handleCoverError(coverImg, game.platform, game.external_id, game.name));
    }
    
    fragment.appendChild(card);
  });

  gamesGrid.appendChild(fragment);
  lucide.createIcons();
  updateStageBackground();
}

// Helper to replace image element with cover placeholder without wiping other components
function replaceImageWithPlaceholder(imgElement, platform, name) {
  const placeholder = document.createElement('div');
  placeholder.className = `cover-placeholder ${escapeHtml(String(platform).toLowerCase())}`;
  placeholder.innerHTML = `
    <i data-lucide="gamepad" class="placeholder-icon"></i>
    <div class="placeholder-title">${escapeHtml(name)}</div>
  `;
  imgElement.replaceWith(placeholder);
  lucide.createIcons();
}

// Fallback handling for missing game covers
function handleCoverError(imgElement, platform, externalId, name) {
  if (imgElement.getAttribute('data-fallback-step') === 'header') {
    replaceImageWithPlaceholder(imgElement, platform, name);
  } else {
    imgElement.setAttribute('data-fallback-step', 'header');
    
    if (platform === 'Steam') {
      imgElement.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${externalId}/header.jpg`;
    } else {
      replaceImageWithPlaceholder(imgElement, platform, name);
    }
  }
}

// Helper to get games matching the selected store/platform tab (ignoring search queries)
function getTabFilteredGames() {
  if (!appState.games || appState.games.length === 0) return [];
  if (appState.filters === 'all') {
    return appState.games;
  }
  return appState.games.filter(game => {
    if (appState.filters === 'other') {
      const knownPlatforms = ['Steam', 'GOG', 'Epic', 'Legacy', 'Amazon Gaming', 'Microsoft Store', 'Luna', 'Itch.io', 'itch.io', 'Stove', 'Ubisoft', 'IndieGala'];
      return !knownPlatforms.includes(game.platform) && game.platform?.toLowerCase() !== 'itch.io';
    } else if (appState.filters === 'Luna') {
      return game.platform === 'Luna' || game.platform === 'Amazon Gaming';
    } else if (appState.filters === 'Itch.io') {
      return game.platform === 'Itch.io' || game.platform?.toLowerCase() === 'itch.io';
    } else {
      return game.platform === appState.filters;
    }
  });
}

// Smooth Count-Up / Counter animation helper
const activeCounters = new WeakMap();

function animateCounter(element, targetValue, { duration = 750, suffix = '', formatter = (n) => Math.round(n).toLocaleString() } = {}) {
  if (!element) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = `${formatter(targetValue)}${suffix}`;
    activeCounters.set(element, { currentValue: targetValue, rafId: null });
    return;
  }

  const prev = activeCounters.get(element);
  if (prev && prev.rafId) {
    cancelAnimationFrame(prev.rafId);
  }

  let startValue = 0;
  if (prev && typeof prev.currentValue === 'number' && !isNaN(prev.currentValue)) {
    startValue = prev.currentValue;
  } else {
    const parsed = parseFloat(element.textContent.replace(/[^0-9.]/g, ''));
    startValue = isNaN(parsed) ? 0 : parsed;
  }

  if (startValue === targetValue) {
    element.textContent = `${formatter(targetValue)}${suffix}`;
    activeCounters.set(element, { currentValue: targetValue, rafId: null });
    return;
  }

  const startTime = performance.now();

  function easeOutExpo(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = easeOutExpo(progress);
    const currentValue = startValue + (targetValue - startValue) * ease;

    element.textContent = `${formatter(currentValue)}${suffix}`;

    if (progress < 1) {
      const rafId = requestAnimationFrame(frame);
      activeCounters.set(element, { currentValue, rafId });
    } else {
      element.textContent = `${formatter(targetValue)}${suffix}`;
      activeCounters.set(element, { currentValue: targetValue, rafId: null });
    }
  }

  const rafId = requestAnimationFrame(frame);
  activeCounters.set(element, { currentValue: startValue, rafId });
}

// Update Stats Dashboard Summary (based strictly on active store/platform filter tab)
function updateStats() {
  if (isAppPreloaderActive) {
    return;
  }
  const tabGames = getTabFilteredGames();

  const totalGames = tabGames.length;
  const totalMinutes = tabGames.reduce((sum, g) => sum + g.playtime_forever, 0);
  const totalHours = Math.round(totalMinutes / 60);

  animateCounter(statTotalGames, totalGames, { duration: 900 });
  animateCounter(statTotalHours, totalHours, { duration: 900, suffix: ' hrs' });
}

// Sticky navbar auto-hide: hides when scrolling down, reveals when scrolling up
function initStickyNav() {
  const scroller = document.querySelector('.main-content');
  const navbar = document.querySelector('.top-navbar');
  if (!scroller || !navbar) return;

  let lastScroll = scroller.scrollTop;

  // Start transparent at the top
  navbar.classList.add('nav-top');

  scroller.addEventListener('scroll', () => {
    const current = scroller.scrollTop;

    if (current <= 4) {
      // Near the top: show + blend with backdrop
      navbar.classList.remove('nav-hidden');
      navbar.classList.add('nav-top');
    } else {
      // Scrolled away: use the glassy (scrolled) style
      navbar.classList.remove('nav-top');

      if (current > lastScroll) {
        // Scrolling down -> hide
        navbar.classList.add('nav-hidden');
      } else {
        // Scrolling up -> show
        navbar.classList.remove('nav-hidden');
      }
    }

    lastScroll = current;
  }, { passive: true });
}

// Page Switcher Action
function showPage(pageName) {
  if (pageName === 'library') {
    libraryView.classList.remove('hidden');
    settingsView.classList.add('hidden');
    navLibrary.classList.add('active');
    navSettingsBtn.classList.remove('active');
    if (typeof window.updateFilterPillGlider === 'function') {
      requestAnimationFrame(() => {
        window.updateFilterPillGlider(null, true);
      });
    }
  } else if (pageName === 'settings') {
    libraryView.classList.add('hidden');
    settingsView.classList.remove('hidden');
    navLibrary.classList.remove('active');
    navSettingsBtn.classList.add('active');
  }
}

let lastFocusedElement = null;
let activeModal = null;

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null || el === document.activeElement);
}

function trapFocus(e) {
  if (!activeModal || e.key !== 'Tab') return;
  const focusables = getFocusableElements(activeModal.querySelector('.settings-panel'));
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function handleModalEscape(e) {
  if (e.key === 'Escape' && activeModal) {
    e.preventDefault();
    if (activeModal === confirmModalEl) {
      closeModal(activeModal);
      resolveConfirm(false);
    } else if (activeModal === addGameModal) closeAddGame();
    else if (activeModal === document.getElementById('edit-game-modal')) closeEditGameModal();
  }
}

function openModal(modal) {
  lastFocusedElement = document.activeElement;
  activeModal = modal;
  modal.classList.add('open');
  document.addEventListener('keydown', trapFocus);
  document.addEventListener('keydown', handleModalEscape);
  requestAnimationFrame(() => {
    const focusables = getFocusableElements(modal.querySelector('.settings-panel'));
    if (focusables[0]) focusables[0].focus();
  });
}

function closeModal(modal) {
  modal.classList.remove('open');
  document.removeEventListener('keydown', trapFocus);
  document.removeEventListener('keydown', handleModalEscape);
  activeModal = null;
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;
}

// ---------------------------------------------------------------------------
// Custom confirm dialog replacing native confirm() (audit F10.3).
// Returns a Promise<boolean>. Non-blocking, matches the app's modal styling,
// and reuses the shared focus-trap/Escape infrastructure via openModal().
// ---------------------------------------------------------------------------
let confirmResolver = null;

function resolveConfirm(result) {
  if (typeof confirmResolver === 'function') {
    const resolver = confirmResolver;
    confirmResolver = null;
    resolver(result);
  }
}

function showConfirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    const modal = confirmModalEl || document.getElementById('confirm-modal');
    // Fallback to native confirm() if the dialog markup is unavailable
    if (!modal) {
      resolve(window.confirm(message));
      return;
    }
    // Never leave a stale resolver pending if dialogs somehow stack
    if (confirmResolver) resolveConfirm(false);

    const titleText = document.getElementById('confirm-modal-title-text');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-ok-btn');
    const cancelBtn = document.getElementById('confirm-cancel-btn');

    if (titleText) titleText.textContent = title;
    if (messageEl) messageEl.textContent = message; // textContent — XSS-safe
    okBtn.textContent = confirmLabel;
    okBtn.classList.toggle('btn-danger', danger);
    okBtn.classList.toggle('btn-primary', !danger);
    cancelBtn.textContent = cancelLabel;

    confirmResolver = resolve;
    openModal(modal);

    // Focus Cancel (not OK) so a stray Enter can't confirm a destructive action
    requestAnimationFrame(() => cancelBtn.focus());
  });
}

function openAddGame() {
  openModal(addGameModal);
}

function closeAddGame() {
  if (!addGameModal.classList.contains('open')) return;
  closeModal(addGameModal);
  steamSearchResults.innerHTML = '';
  steamSearchResults.classList.add('hidden');
}

function closeEditGameModal() {
  const modal = document.getElementById('edit-game-modal');
  if (!modal || !modal.classList.contains('open')) return;
  const results = document.getElementById('edit-search-results');
  if (results) {
    results.innerHTML = '';
    results.classList.add('hidden');
  }
  closeModal(modal);
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  else if (type === 'error') icon = 'alert-triangle';
  
  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();

  const removeToast = () => {
    toast.style.animation = 'toastOut 220ms var(--ease-in-out) both';
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  setTimeout(removeToast, 3800);
  toast.addEventListener('click', removeToast, { once: true });
  toast.style.cursor = 'pointer';
}

// Open Edit Game Sidebar Modal (uses same slide-over settings-panel UI as Add Game)
function openEditGameSidebar(platform, externalId) {
  const game = appState.games.find(g => g.platform === platform && String(g.external_id) === String(externalId));
  if (!game) return;

  const editModal = document.getElementById('edit-game-modal');
  const origPlatformInput = document.getElementById('edit-game-orig-platform');
  const origExtIdInput = document.getElementById('edit-game-orig-ext-id');
  const titleInput = document.getElementById('edit-game-title');
  const platformSelect = document.getElementById('edit-game-platform');
  const coverInput = document.getElementById('edit-game-cover');
  const backdropInput = document.getElementById('edit-game-backdrop');
  const playtimeInput = document.getElementById('edit-game-playtime');
  const lastPlayedInput = document.getElementById('edit-game-lastplayed');
  const editSearchBox = document.getElementById('edit-search-input');
  const searchResults = document.getElementById('edit-search-results');

  // Preview elements
  const prevTitle = document.getElementById('edit-game-preview-title');
  const prevPlatform = document.getElementById('edit-game-preview-platform');
  const prevPlaytime = document.getElementById('edit-game-preview-playtime');
  const prevImg = document.getElementById('edit-game-preview-img');
  const prevBackdrop = document.getElementById('edit-game-preview-backdrop');

  origPlatformInput.value = game.platform;
  origExtIdInput.value = game.external_id;
  titleInput.value = game.name;
  platformSelect.value = game.platform;
  coverInput.value = game.cover_url || '';
  backdropInput.value = game.backdrop_url || '';
  playtimeInput.value = (game.playtime_forever / 60).toFixed(1);

  if (game.rtime_last_played) {
    const d = new Date(game.rtime_last_played * 1000);
    const dateStr = d.toISOString().split('T')[0];
    lastPlayedInput.value = dateStr;
  } else {
    lastPlayedInput.value = '';
  }

  editSearchBox.value = game.name;
  searchResults.innerHTML = '';
  searchResults.classList.add('hidden');

  function updatePreview() {
    prevTitle.textContent = titleInput.value || game.name;
    prevPlatform.textContent = platformSelect.value || game.platform;
    const hrs = parseFloat(playtimeInput.value) || 0;
    prevPlaytime.innerHTML = `<i data-lucide="clock" class="inline-icon" style="width: 12px; height: 12px;"></i> ${hrs.toFixed(1)} hrs`;
    
    const coverUrl = coverInput.value.trim();
    prevImg.src = coverUrl || NO_COVER_PLACEHOLDER;
    
    const backdropUrl = backdropInput.value.trim();
    // Guard against CSS injection via url("...") breakout (audit F1):
    // only http(s) URLs, with quotes/backslashes stripped.
    if (backdropUrl && isValidHttpUrl(backdropUrl)) {
      prevBackdrop.style.backgroundImage = `url("${backdropUrl.replace(/["\\]/g, '')}")`;
      prevBackdrop.style.display = 'block';
    } else {
      prevBackdrop.style.backgroundImage = 'none';
      prevBackdrop.style.display = 'none';
    }
    lucide.createIcons();
  }

  updatePreview();

  // Attach live update handlers
  [titleInput, platformSelect, coverInput, backdropInput, playtimeInput].forEach(el => {
    el.oninput = updatePreview;
    el.onchange = updatePreview;
  });

  openModal(editModal);
  lucide.createIcons();
}
window.openEditGameSidebar = openEditGameSidebar;

function changeCoverArt(platform, externalId) {
  openEditGameSidebar(platform, externalId);
}
window.changeCoverArt = changeCoverArt;

// Check if game should be excluded by title keyword or blacklist
function shouldExcludeGame(title, appid) {
  if (appid) {
    const appidStr = String(appid);
    const appidNum = Number(appid);
    if (appState.blacklistAppIds.includes(appidNum) || appState.blacklistAppIds.includes(appidStr)) {
      return true;
    }
  }

  if (!title || typeof title !== 'string') return false;

  const titleLower = title.toLowerCase();
  
  // Check user blacklist titles
  const normTitle = titleLower.replace(/[^a-z0-9]/g, '');
  const isBlacklistedTitle = appState.blacklistTitles.some(blacklisted => {
    return blacklisted.toLowerCase().replace(/[^a-z0-9]/g, '') === normTitle;
  });
  if (isBlacklistedTitle) {
    return true;
  }

  // Standalone word/phrase matches for non-games
  const excludes = [
    "dedicated server", "test server", "public test", "playtest", 
    "creator kit", "founder's pack", "founders pack", "development kit", 
    "mod kit", "soundtrack", "artbook", "server tools", "official server"
  ];
  if (excludes.some(keyword => titleLower.includes(keyword))) {
    return true;
  }

  // Specific suffix matches
  if (titleLower.endsWith(" beta") || titleLower.endsWith(" demo") || titleLower.endsWith(" trial")) {
    return true;
  }

  return false;
}

// Delete game from library and add to blacklist
async function deleteAndIgnoreGame(platform, externalId, name) {
  const okIgnore = await showConfirm({
    title: 'Delete & ignore?',
    message: `Are you sure you want to delete and ignore "${name}"? It will be removed and never imported again.`,
    confirmLabel: 'Delete & Ignore',
    danger: true
  });
  if (!okIgnore) {
    return;
  }

  // Remove from local memory
  appState.games = appState.games.filter(g => !(g.platform === platform && String(g.external_id) === String(externalId)));

  // Add to blacklist
  if (platform === 'Steam' && /^\d+$/.test(externalId)) {
    const appidNum = Number(externalId);
    if (!appState.blacklistAppIds.includes(appidNum)) {
      appState.blacklistAppIds.push(appidNum);
    }
  } else {
    const norm = name.toLowerCase().trim();
    if (!appState.blacklistTitles.includes(norm)) {
      appState.blacklistTitles.push(norm);
    }
  }

  // Save changes
  saveSettingsToStorage();

  // If cloud sync is enabled, remove the game row via the backend proxy
  if (isCloudEnabled()) {
    try {
      showToast('Updating cloud database...', 'info');
      await dbDeleteGames([{ platform, external_id: String(externalId) }]);
      showToast(`Deleted ${name} from cloud database!`, 'success');
    } catch (e) {
      console.error(e);
      showToast(`Failed to update cloud database: ${e.message}`, 'error');
    }
  } else {
    showToast(`Removed "${name}" and added to ignore list.`, 'success');
  }

  // Refresh display
  renderGames();
  updateStats();
}
window.deleteAndIgnoreGame = deleteAndIgnoreGame;

