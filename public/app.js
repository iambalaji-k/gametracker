// State Management
let appState = {
  games: [],
  steamId: '',
  vanityUrl: '',
  gogUsername: '',
  epicConnected: false,
  legacyConnected: false,
  filters: 'all',
  searchQuery: '',
  sortKey: 'playtime-desc',
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

// Supabase Client Reference
let supabaseClient = null;

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

// Add Game inputs
const addGameBtn = document.getElementById('add-game-btn');
const addGameModal = document.getElementById('add-game-modal');
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

// Supabase inputs
const supabaseToggle = document.getElementById('supabase-toggle');
const supabaseFields = document.getElementById('supabase-fields');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseAnonKeyInput = document.getElementById('supabase-anon-key');
const saveSupabaseBtn = document.getElementById('save-supabase-btn');
const resolveCoversBtn = document.getElementById('resolve-covers-btn');
const resolveGogCoversBtn = document.getElementById('resolve-gog-covers-btn');
const refreshArtworkBtn = document.getElementById('refresh-artwork-btn');

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

// Build the rotation pool from the synced library (backdrop > steam hero > cover).
function buildBackdropPool() {
  const pool = [];
  const seen = new Set();
  for (const g of appState.games) {
    let url = (g.backdrop_url && String(g.backdrop_url).trim()) ? g.backdrop_url : null;
    if (!url && g.platform === 'Steam' && g.appid) {
      url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_hero.jpg`;
    }
    if (!url && g.cover_url) url = g.cover_url;
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

// Best-effort average luminance -> opacity (brighter images sit dimmer).
// Cross-origin images taint the canvas; we catch that and return null (default).
function sampleBrightness(img) {
  try {
    const w = 16, h = 16;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += lum; n++;
    }
    const t = Math.min(1, Math.max(0, (sum / n) / 255));
    // Bright (t->1) -> lower opacity; dark (t->0) -> higher opacity.
    return BACKDROP_MAX_OPACITY - t * (BACKDROP_MAX_OPACITY - BACKDROP_MIN_OPACITY);
  } catch (e) {
    return null;
  }
}

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
    const op = sampleBrightness(pre) ?? ((BACKDROP_MIN_OPACITY + BACKDROP_MAX_OPACITY) / 2);
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
    backdropFailureCooldown.set(item.url, Date.now() + BACKDROP_RETRY_COOLDOWN);
    scheduleNextBackdrop();
    return;
  }

  const incoming = backdropLayers[1 - backdropActive];
  const outgoing = backdropLayers[backdropActive];
  const img = incoming.querySelector('.backdrop-img');

  // Assign artwork to the hidden layer and (re)start its Ken Burns from the top.
  img.src = item.url;
  const op = sampleBrightness(pre) ?? ((BACKDROP_MIN_OPACITY + BACKDROP_MAX_OPACITY) / 2);
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

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
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
  
  // Try connecting to Supabase if configured
  await initializeSupabase();

  // Check Twitch/IGDB API credentials status
  await checkIgdbStatus();
  
  // Initial render
  if (appState.games && appState.games.length > 0) {
    emptyState.classList.add('hidden');
    renderGames();
    updateStats();
  } else {
    // If Supabase is connected, try to fetch cached database games first
    if (appState.supabaseConfig.enabled && supabaseClient) {
      await fetchGamesFromSupabase();
    } else {
      emptyState.classList.remove('hidden');
    }
  }
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
      
      if (appState.epicConnected) {
        resolvedEpicCard.classList.remove('hidden');
      }

      if (appState.legacyConnected) {
        resolvedLegacyCard.classList.remove('hidden');
      }


      
      supabaseToggle.checked = appState.supabaseConfig.enabled;
      if (appState.supabaseConfig.enabled) {
        supabaseFields.classList.remove('hidden');
      }
      supabaseUrlInput.value = appState.supabaseConfig.url || '';
      supabaseAnonKeyInput.value = appState.supabaseConfig.anonKey || '';
    } catch (e) {
      console.error('Error parsing saved settings state:', e);
    }
  }
}

// Save settings to local storage
function saveSettingsToStorage() {
  const dataToSave = {
    games: appState.games,
    steamId: appState.steamId,
    vanityUrl: appState.vanityUrl,
    gogUsername: appState.gogUsername,
    epicConnected: appState.epicConnected,
    legacyConnected: appState.legacyConnected,
    supabaseConfig: appState.supabaseConfig,
    blacklistAppIds: appState.blacklistAppIds,
    blacklistTitles: appState.blacklistTitles
  };
  localStorage.setItem('crossplay_state', JSON.stringify(dataToSave));
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

  // Search, Filter & Sort
  searchInput.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value.toLowerCase();
    renderGames();
  });

  sortSelect.addEventListener('change', (e) => {
    appState.sortKey = e.target.value;
    renderGames();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      appState.filters = e.target.dataset.filter;
      renderGames();
    });
  });

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

  // Epic Games - Copy Extractor Script
  copyEpicScriptBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(EPIC_EXTRACTOR_SCRIPT);
      showToast('Extractor script copied to clipboard! Run it on Epic Transactions page.', 'success');
    } catch (err) {
      showToast('Failed to copy automatically. Please copy the script from the source.', 'error');
    }
  });

  // Epic Games - Import Paste Action
  importEpicBtn.addEventListener('click', async () => {
    const rawJson = epicJsonInput.value.trim();
    if (!rawJson) {
      showToast('Please paste the extracted JSON array first!', 'error');
      return;
    }

    importEpicBtn.disabled = true;
    importEpicBtn.textContent = 'Parsing & Importing...';
    
    try {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) {
        throw new Error('Pasted content is not a valid JSON array. Please rerun the script and copy the full output.');
      }

      showToast(`Pasted ${parsed.length} games. Resolving cover arts via Steam API...`, 'info');
      
      // Map JSON properties to our internal format
      const newEpicGames = parsed
        .filter(game => !shouldExcludeGame(game.title, game.id))
        .map(game => ({
          external_id: game.id || String(Math.floor(Math.random() * 1000000)),
          platform: 'Epic',
          appid: game.id || '',
          name: game.title,
          playtime_forever: 0, // Playtime not available in Epic transaction logs
          rtime_last_played: game.date ? Math.floor(new Date(game.date).getTime() / 1000) : 0,
        cover_url: null
      }));

      // Resolve cover arts in parallel chunks to avoid server overloading
      const batchSize = 10;
      for (let i = 0; i < newEpicGames.length; i += batchSize) {
        const batch = newEpicGames.slice(i, i + batchSize);
        
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

      // Merge into state (overwrite only Epic, preserve GOG and Steam)
      appState.games = [
        ...appState.games.filter(g => g.platform !== 'Epic'),
        ...newEpicGames
      ];

      appState.epicConnected = true;
      saveSettingsToStorage();

      // Show resolved card
      resolvedEpicCard.classList.remove('hidden');
      epicJsonInput.value = ''; // Clean up

      if (appState.supabaseConfig.enabled && supabaseClient) {
        showToast('Syncing Epic library to Supabase...', 'info');
        await syncGamesToSupabase(appState.games);
      }

      emptyState.classList.add('hidden');
      renderGames();
      updateStats();
      showToast(`Successfully imported ${newEpicGames.length} Epic Games!`, 'success');
      showPage('library');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    } finally {
      importEpicBtn.disabled = false;
      importEpicBtn.textContent = 'Import Epic Games Library';
    }
  });

  // Legacy Games - Copy Extractor Script
  copyLegacyScriptBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(LEGACY_EXTRACTOR_SCRIPT);
      showToast('Legacy extractor script copied to clipboard! Run it on Legacy Games Downloads/Free Games page.', 'success');
    } catch (err) {
      showToast('Failed to copy automatically. Please copy the script from the source.', 'error');
    }
  });

  // Legacy Games - Import Paste Action
  importLegacyBtn.addEventListener('click', async () => {
    const rawJson = legacyJsonInput.value.trim();
    if (!rawJson) {
      showToast('Please paste the extracted JSON array first!', 'error');
      return;
    }

    importLegacyBtn.disabled = true;
    importLegacyBtn.textContent = 'Parsing & Importing...';
    
    try {
      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed)) {
        throw new Error('Pasted content is not a valid JSON array.');
      }

      showToast(`Pasted ${parsed.length} games. Resolving cover arts via Steam API...`, 'info');
      
      const newLegacyGames = parsed
        .filter(game => !shouldExcludeGame(game.title, game.id))
        .map(game => ({
          external_id: game.id || String(Math.floor(Math.random() * 1000000)),
          platform: 'Legacy',
          appid: game.id || '',
          name: game.title,
          playtime_forever: 0,
          rtime_last_played: 0,
          cover_url: null
        }));

      // Resolve covers in batches
      const batchSize = 10;
      for (let i = 0; i < newLegacyGames.length; i += batchSize) {
        const batch = newLegacyGames.slice(i, i + batchSize);
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

      // Merge into state
      appState.games = [
        ...appState.games.filter(g => g.platform !== 'Legacy'),
        ...newLegacyGames
      ];

      appState.legacyConnected = true;
      saveSettingsToStorage();

      resolvedLegacyCard.classList.remove('hidden');
      legacyJsonInput.value = '';

      if (appState.supabaseConfig.enabled && supabaseClient) {
        showToast('Syncing Legacy Games library to Supabase...', 'info');
        await syncGamesToSupabase(appState.games);
      }

      emptyState.classList.add('hidden');
      renderGames();
      updateStats();
      showToast(`Successfully imported ${newLegacyGames.length} Legacy Games!`, 'success');
      showPage('library');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    } finally {
      importLegacyBtn.disabled = false;
      importLegacyBtn.textContent = 'Import Legacy Games Library';
    }
  });





  // Supabase Toggle fields
  supabaseToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      supabaseFields.classList.remove('hidden');
    } else {
      supabaseFields.classList.add('hidden');
      appState.supabaseConfig.enabled = false;
      saveSettingsToStorage();
      updateConnectionStatusUI();
      showToast('Supabase Sync Disabled', 'info');
    }
  });

  // Save Supabase Configuration
  saveSupabaseBtn.addEventListener('click', async () => {
    const url = supabaseUrlInput.value.trim();
    const anonKey = supabaseAnonKeyInput.value.trim();
    
    if (!url || !anonKey) {
      showToast('Supabase URL and Anon Key are required', 'error');
      return;
    }
    
    saveSupabaseBtn.disabled = true;
    saveSupabaseBtn.textContent = 'Testing Connection...';
    
    try {
      const testClient = supabase.createClient(url, anonKey);
      const { error } = await testClient.from('games').select('count', { count: 'exact', head: true });
      
      if (error) throw error;
      
      appState.supabaseConfig.url = url;
      appState.supabaseConfig.anonKey = anonKey;
      appState.supabaseConfig.enabled = true;
      saveSettingsToStorage();
      
      supabaseClient = testClient;
      updateConnectionStatusUI();
      showToast('Supabase connection tested and saved successfully!', 'success');
      
      await fetchGamesFromSupabase();
    } catch (err) {
      console.error(err);
      showToast(`Connection failed: ${err.message || 'Check database table and RLS policies'}`, 'error');
    } finally {
      saveSupabaseBtn.disabled = false;
      saveSupabaseBtn.textContent = 'Save & Test Connection';
    }
  });

  // Platform Sync triggers (merged button syncs both; dropdown syncs individually)
  syncAllBtn.addEventListener('click', () => triggerSync(['Steam', 'GOG']));
  syncDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = syncMenu.classList.toggle('hidden');
    syncDropdownToggle.setAttribute('aria-expanded', String(!isHidden));
  });
  syncMenu.querySelectorAll('.sync-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const platform = item.dataset.sync;
      syncMenu.classList.add('hidden');
      syncDropdownToggle.setAttribute('aria-expanded', 'false');
      triggerSync([platform]);
    });
  });
  document.addEventListener('click', (e) => {
    if (!syncMenu.contains(e.target) && e.target !== syncDropdownToggle && !syncDropdownToggle.contains(e.target)) {
      syncMenu.classList.add('hidden');
      syncDropdownToggle.setAttribute('aria-expanded', 'false');
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
          <img class="search-result-img" src="${item.tiny_image}" alt="${item.name}">
          <span class="search-result-name">${item.name}</span>
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

    // Check for duplicates
    const exists = appState.games.some(g => g.name.toLowerCase() === title.toLowerCase() && g.platform === platform);
    if (exists) {
      showToast(`"${title}" is already in your library on ${platform}!`, 'error');
      return;
    }

    // Add to state
    appState.games.push(newGame);
    saveSettingsToStorage();

    // Sync with Supabase if enabled
    if (appState.supabaseConfig.enabled && supabaseClient) {
      try {
        const row = {
          external_id: externalId,
          platform: platform,
          title: title,
          playtime_forever: playtimeMinutes,
          last_played: lastPlayedStr ? new Date(lastPlayedStr).toISOString() : null,
          cover_url: coverUrl
        };
        const { error } = await supabaseClient
          .from('games')
          .upsert(row, { onConflict: 'platform,external_id' });
        if (error) throw error;
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

  // Resolve Missing Covers trigger
  resolveCoversBtn.addEventListener('click', async () => {
    const missingCoverGames = appState.games.filter(g => !g.cover_url);
    if (missingCoverGames.length === 0) {
      showToast('All games in your library already have cover art!', 'info');
      return;
    }

    resolveCoversBtn.disabled = true;
    resolveCoversBtn.innerHTML = '<i class="inline-icon syncing-rotate" data-lucide="refresh-cw"></i> Resolving...';
    lucide.createIcons();
    showToast(`Scanning and resolving covers for ${missingCoverGames.length} games...`, 'info');

    let resolvedCount = 0;
    const batchSize = 5;
    for (let i = 0; i < missingCoverGames.length; i += batchSize) {
      const batch = missingCoverGames.slice(i, i + batchSize);
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
              
              if (appState.supabaseConfig.enabled && supabaseClient) {
                const row = {
                  external_id: String(game.external_id),
                  platform: game.platform,
                  title: game.name,
                  playtime_forever: game.playtime_forever,
                  last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
                  cover_url: game.cover_url,
                  backdrop_url: game.backdrop_url || null
                };
                await supabaseClient
                  .from('games')
                  .upsert(row, { onConflict: 'platform,external_id' });
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
    
    resolveCoversBtn.disabled = false;
    resolveCoversBtn.innerHTML = '<i data-lucide="image-down" class="inline-icon"></i> Scan & Resolve Missing Covers';
    lucide.createIcons();
    
    if (resolvedCount > 0) {
      showToast(`Successfully resolved cover art for ${resolvedCount} games!`, 'success');
    } else {
      showToast('Could not find cover art for any of the missing games.', 'info');
    }
  });

  // Resolve GOG landscape covers trigger
  resolveGogCoversBtn.addEventListener('click', async () => {
    const gogGames = appState.games.filter(g => g.platform === 'GOG');
    if (gogGames.length === 0) {
      showToast('No GOG games in your library to resolve covers for!', 'info');
      return;
    }

    resolveGogCoversBtn.disabled = true;
    resolveGogCoversBtn.innerHTML = '<i class="inline-icon syncing-rotate" data-lucide="refresh-cw"></i> Resolving GOG Covers...';
    lucide.createIcons();
    showToast(`Scanning and upgrading covers for ${gogGames.length} GOG games...`, 'info');

    let resolvedCount = 0;
    const batchSize = 5;
    for (let i = 0; i < gogGames.length; i += batchSize) {
      const batch = gogGames.slice(i, i + batchSize);
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
              
              if (appState.supabaseConfig.enabled && supabaseClient) {
                const row = {
                  external_id: String(game.external_id),
                  platform: game.platform,
                  title: game.name,
                  playtime_forever: game.playtime_forever,
                  last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
                  cover_url: game.cover_url,
                  backdrop_url: game.backdrop_url || null
                };
                await supabaseClient
                  .from('games')
                  .upsert(row, { onConflict: 'platform,external_id' });
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
    
    resolveGogCoversBtn.disabled = false;
    resolveGogCoversBtn.innerHTML = '<i data-lucide="image" class="inline-icon"></i> Upgrade GOG Covers to Vertical (IGDB/Steam)';
    lucide.createIcons();
    
    if (resolvedCount > 0) {
      showToast(`Successfully upgraded cover art for ${resolvedCount} GOG games!`, 'success');
    } else {
      showToast('Could not find vertical cover art for any GOG games.', 'info');
    }
  });

  // Refresh Artwork & Backdrops: populate backdrop_url (and missing covers) for ALL games
  // without a full resync. Steam derives its hero art directly from the AppID (no network);
  // other platforms resolve via Steam/IGDB search.
  refreshArtworkBtn.addEventListener('click', async () => {
    if (appState.games.length === 0) {
      showToast('Your library is empty. Sync a platform first!', 'info');
      return;
    }

    refreshArtworkBtn.disabled = true;
    refreshArtworkBtn.innerHTML = '<i class="inline-icon syncing-rotate" data-lucide="refresh-cw"></i> Refreshing artwork...';
    lucide.createIcons();
    showToast(`Refreshing artwork & backdrops for ${appState.games.length} games...`, 'info');

    let resolvedCount = 0;
    const batchSize = 10;
    for (let i = 0; i < appState.games.length; i += batchSize) {
      const batch = appState.games.slice(i, i + batchSize);
      await Promise.all(batch.map(async game => {
        try {
          if (game.platform === 'Steam' && game.appid) {
            const heroUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_hero.jpg`;
            if (!game.backdrop_url || String(game.backdrop_url).trim() !== heroUrl) {
              game.backdrop_url = heroUrl;
              resolvedCount++;
            }
          } else {
            const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
            if (res.ok) {
              const data = await res.json();
              let changed = false;
              if (data.backdrop_url && data.backdrop_url !== game.backdrop_url) {
                game.backdrop_url = data.backdrop_url;
                changed = true;
              }
              if (!game.cover_url && data.cover_url) {
                game.cover_url = data.cover_url;
                changed = true;
              }
              if (changed) resolvedCount++;
            }
          }

          if (appState.supabaseConfig.enabled && supabaseClient) {
            const row = {
              external_id: String(game.external_id),
              platform: game.platform,
              title: game.name,
              playtime_forever: game.playtime_forever,
              last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
              cover_url: game.cover_url,
              backdrop_url: game.backdrop_url || null
            };
            await supabaseClient
              .from('games')
              .upsert(row, { onConflict: 'platform,external_id' });
          }
        } catch (e) {
          console.error(`Failed to refresh artwork for ${game.name}:`, e);
        }
      }));
    }

    saveSettingsToStorage();
    renderGames();
    updateStageBackground();
    updateStats();

    refreshArtworkBtn.disabled = false;
    refreshArtworkBtn.innerHTML = '<i data-lucide="image" class="inline-icon"></i> Refresh Artwork & Backdrops';
    lucide.createIcons();

    if (resolvedCount > 0) {
      showToast(`Refreshed artwork & backdrops for ${resolvedCount} games!`, 'success');
    } else {
      showToast('All games already have artwork & backdrops.', 'info');
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
      changeCoverArt(platform, externalId);
      return;
    }
  });
}

// Initialize Supabase Connection
async function initializeSupabase() {
  if (appState.supabaseConfig.enabled && appState.supabaseConfig.url && appState.supabaseConfig.anonKey) {
    try {
      supabaseClient = supabase.createClient(appState.supabaseConfig.url, appState.supabaseConfig.anonKey);
      updateConnectionStatusUI();
    } catch (err) {
      console.error('Failed to initialize Supabase Client:', err);
      appState.supabaseConfig.enabled = false;
      updateConnectionStatusUI();
    }
  } else {
    updateConnectionStatusUI();
  }
}

// Update Database Connection status text and dots
function updateConnectionStatusUI() {
  if (appState.supabaseConfig.enabled && supabaseClient) {
    connectionStatus.classList.remove('offline');
    connectionStatus.classList.add('online');
    connectionText.textContent = 'Supabase Connected';
  } else {
    connectionStatus.classList.remove('online');
    connectionStatus.classList.add('offline');
    connectionText.textContent = 'Local Storage Mode';
  }
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

// Fetch Games from Supabase
async function fetchGamesFromSupabase() {
  if (!supabaseClient) return;
  
  try {
    const { data, error } = await supabaseClient
      .from('games')
      .select('*')
      .order('playtime_forever', { ascending: false });
      
    if (error) throw error;
    
    if (data && data.length > 0) {
      appState.games = data.map(item => ({
        external_id: item.external_id,
        platform: item.platform,
        appid: item.platform === 'Steam' ? Number(item.external_id) : item.external_id,
        name: item.title,
        playtime_forever: item.playtime_forever,
        rtime_last_played: item.last_played ? Math.floor(new Date(item.last_played).getTime() / 1000) : 0,
        cover_url: item.cover_url,
        backdrop_url: item.backdrop_url || null
      }));
      
      saveSettingsToStorage();
      emptyState.classList.add('hidden');
      renderGames();
      updateStats();
      showToast(`Imported ${data.length} games from Supabase cloud database`, 'success');
    }
  } catch (err) {
    console.error('Error fetching from Supabase:', err);
    showToast('Failed to load games from Supabase cloud database', 'error');
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
    
    const steamGames = data.response.games;
    
    const newSteamGames = steamGames
      .filter(game => !shouldExcludeGame(game.name, game.appid))
      .map(game => {
        const appid = game.appid;
        const coverUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
        const backdropUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`;
        return {
          external_id: String(game.appid),
          platform: 'Steam',
          appid: game.appid,
          name: game.name,
          playtime_forever: game.playtime_forever,
          rtime_last_played: game.rtime_last_played || 0,
          cover_url: coverUrl,
          backdrop_url: backdropUrl
        };
      });

    appState.games = [
      ...appState.games.filter(g => g.platform !== 'Steam'),
      ...newSteamGames
    ];

    saveSettingsToStorage();
    
    if (appState.supabaseConfig.enabled && supabaseClient) {
      showToast('Syncing Steam library with Supabase...', 'info');
      await syncGamesToSupabase(appState.games);
    }
    
    renderGames();
    updateStats();
    showToast(`Successfully synced ${newSteamGames.length} Steam games!`, 'success');

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
    
    const newGogGames = gogGames
      .filter(game => !shouldExcludeGame(game.name, game.appid))
      .map(game => {
        let cover = game.cover_url || '';
        if (cover.startsWith('//')) {
          cover = 'https:' + cover;
        }
        return {
          external_id: String(game.appid),
          platform: 'GOG',
          appid: game.appid,
          name: game.name,
          playtime_forever: game.playtime_forever,
          rtime_last_played: 0,
          cover_url: cover
        };
      });

    // Resolve a landscape backdrop via Steam/IGDB search (GOG has no native hero art).
    // Only fall back to a vertical cover when GOG itself provided none.
    const gogBatchSize = 10;
    for (let i = 0; i < newGogGames.length; i += gogBatchSize) {
      const batch = newGogGames.slice(i, i + gogBatchSize);
      await Promise.all(batch.map(async game => {
        try {
          const res = await fetch(`/api/games/search-cover?name=${encodeURIComponent(game.name)}`);
          if (res.ok) {
            const coverData = await res.json();
            if (coverData.backdrop_url) {
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
      ...appState.games.filter(g => g.platform !== 'GOG'),
      ...newGogGames
    ];

    saveSettingsToStorage();
    
    if (appState.supabaseConfig.enabled && supabaseClient) {
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

// Orchestrate a sync of one or both platforms from the merged button / dropdown
async function triggerSync(platforms) {
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

  // Visual feedback on the merged button
  if (syncAllBtn) syncAllBtn.disabled = true;
  if (syncDropdownToggle) syncDropdownToggle.disabled = true;
  if (syncAllIcon) syncAllIcon.classList.add('syncing-rotate');
  loadingText.textContent = `Syncing ${platforms.join(' & ')} Library...`;
  loadingSpinner.classList.remove('hidden');
  gamesGrid.classList.add('hidden');
  emptyState.classList.add('hidden');

  const tasks = [];
  if (platforms.includes('Steam')) tasks.push(syncSteamLibraryCore());
  if (platforms.includes('GOG')) tasks.push(syncGogLibraryCore());

  await Promise.allSettled(tasks);

  loadingSpinner.classList.add('hidden');
  gamesGrid.classList.remove('hidden');
  if (syncAllBtn) syncAllBtn.disabled = false;
  if (syncDropdownToggle) syncDropdownToggle.disabled = false;
  if (syncAllIcon) syncAllIcon.classList.remove('syncing-rotate');

  if (appState.games.length === 0) {
    emptyState.classList.remove('hidden');
  }
}

// Push local games to Supabase using unified structure
async function syncGamesToSupabase(gamesList) {
  if (!supabaseClient) return;

  try {
    const rows = gamesList.map(game => ({
      external_id: String(game.external_id),
      platform: game.platform,
      title: game.name,
      playtime_forever: game.playtime_forever,
      last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
      cover_url: game.cover_url
    }));

    const { error } = await supabaseClient
      .from('games')
      .upsert(rows, { onConflict: 'platform,external_id' });

    if (error) throw error;
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
  } else {
    // For others (Legacy, Amazon Gaming, Microsoft Store, Custom, etc.) show official joystick SVG
    platformClass = p.includes('legacy') ? 'legacy' : (p.includes('amazon') ? 'amazon' : (p.includes('microsoft') ? 'microsoft' : 'other'));
    iconHtml = `<svg class="platform-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2Z"/>
      <path d="M6 15v-2"/>
      <path d="M12 15V9"/>
      <circle cx="12" cy="5" r="3"/>
    </svg>`;
  }
  
  return `<span class="card-badge platform-badge ${platformClass}" title="${platform}">
    ${iconHtml}
  </span>`;
}

// Render Games Grid
function renderGames() {
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
        const knownPlatforms = ['Steam', 'GOG', 'Epic', 'Legacy', 'Amazon Gaming', 'Microsoft Store', 'Luna'];
        matchesTab = !knownPlatforms.includes(game.platform);
      } else if (appState.filters === 'Luna') {
        matchesTab = game.platform === 'Luna' || game.platform === 'Amazon Gaming';
      } else {
        matchesTab = game.platform === appState.filters;
      }
    }
    
    return matchesSearch && matchesTab;
  });

  // Sort games
  filteredGames.sort((a, b) => {
    if (appState.sortKey === 'playtime-desc') {
      return b.playtime_forever - a.playtime_forever;
    } else if (appState.sortKey === 'playtime-asc') {
      return a.playtime_forever - b.playtime_forever;
    } else if (appState.sortKey === 'lastplayed-desc') {
      return b.rtime_last_played - a.rtime_last_played;
    } else if (appState.sortKey === 'name-asc') {
      return a.name.localeCompare(b.name);
    } else if (appState.sortKey === 'name-desc') {
      return b.name.localeCompare(a.name);
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

  filteredGames.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';
    
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
    
    card.innerHTML = `
      <div class="game-cover-container">
        ${platformBadgeHtml}
        <button class="edit-cover-btn" title="Edit Cover Art" data-platform="${game.platform}" data-external-id="${game.external_id}">
          <i data-lucide="edit-3"></i>
        </button>
        <button class="delete-game-btn" title="Delete & Ignore Game" data-platform="${game.platform}" data-external-id="${game.external_id}" data-name="${game.name.replace(/"/g, '&quot;')}">
          <i data-lucide="trash-2"></i>
        </button>
        ${coverPath ? 
          `<img class="game-cover" 
                src="${coverPath}" 
                alt="${game.name}" 
                loading="lazy">`
          :
          `<div class="cover-placeholder ${game.platform.toLowerCase()}">
             <i data-lucide="gamepad" class="placeholder-icon"></i>
             <div class="placeholder-title">${game.name}</div>
           </div>`
        }
      </div>
      <div class="game-card-info">
        <h4 class="game-title" title="${game.name}">${game.name}</h4>
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
  placeholder.className = `cover-placeholder ${platform.toLowerCase()}`;
  placeholder.innerHTML = `
    <i data-lucide="gamepad" class="placeholder-icon"></i>
    <div class="placeholder-title">${name}</div>
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

// Update Stats Dashboard Summary
function updateStats() {
  if (appState.games.length === 0) {
    statTotalGames.textContent = '0';
    statTotalHours.textContent = '0 hrs';
    return;
  }

  const totalGames = appState.games.length;

  // Hours
  const totalMinutes = appState.games.reduce((sum, g) => sum + g.playtime_forever, 0);
  const totalHours = Math.round(totalMinutes / 60);

  statTotalGames.textContent = totalGames.toLocaleString();
  statTotalHours.textContent = `${totalHours.toLocaleString()} hrs`;
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
  } else if (pageName === 'settings') {
    libraryView.classList.add('hidden');
    settingsView.classList.remove('hidden');
    navLibrary.classList.remove('active');
    navSettingsBtn.classList.add('active');
  }
}

// Add Game modal helpers
function openAddGame() {
  addGameModal.classList.add('open');
}

function closeAddGame() {
  addGameModal.classList.remove('open');
  steamSearchResults.innerHTML = '';
  steamSearchResults.classList.add('hidden');
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  else if (type === 'error') icon = 'alert-triangle';
  
  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// Change Cover Art for a specific game manually
window.changeCoverArt = async (platform, externalId) => {
  const game = appState.games.find(g => g.platform === platform && String(g.external_id) === String(externalId));
  if (!game) return;

  const currentCover = game.cover_url || '';
  const newUrl = prompt(`Enter new cover image URL for "${game.name}":`, currentCover);
  
  if (newUrl === null) return; // User cancelled

  game.cover_url = newUrl.trim() || null;
  saveSettingsToStorage();
  
  // If Supabase is connected, sync this single game change
  if (appState.supabaseConfig.enabled && supabaseClient) {
    try {
      const row = {
        external_id: String(game.external_id),
        platform: game.platform,
        title: game.name,
        playtime_forever: game.playtime_forever,
        last_played: game.rtime_last_played ? new Date(game.rtime_last_played * 1000).toISOString() : null,
        cover_url: game.cover_url
      };
      
      const { error } = await supabaseClient
        .from('games')
        .upsert(row, { onConflict: 'platform,external_id' });
        
      if (error) throw error;
      showToast(`Updated cover for ${game.name} in cloud database!`, 'success');
    } catch (e) {
      console.error(e);
      showToast(`Failed to update cloud database: ${e.message}`, 'error');
    }
  } else {
    showToast(`Updated cover for ${game.name} locally!`, 'success');
  }
  
  renderGames();
};

// Check if game should be excluded by title keyword or blacklist
function shouldExcludeGame(title, appid) {
  if (appid) {
    const appidStr = String(appid);
    const appidNum = Number(appid);
    if (appState.blacklistAppIds.includes(appidNum) || appState.blacklistAppIds.includes(appidStr)) {
      return true;
    }
  }

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
window.deleteAndIgnoreGame = async (platform, externalId, name) => {
  if (!confirm(`Are you sure you want to delete and ignore "${name}"? It will be removed and never imported again.`)) {
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

  // If Supabase is connected, sync the updated list
  if (appState.supabaseConfig.enabled && supabaseClient) {
    try {
      showToast('Updating cloud database...', 'info');
      const { error } = await supabaseClient
        .from('games')
        .delete()
        .match({ platform, external_id: String(externalId) });
        
      if (error) throw error;
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
};

