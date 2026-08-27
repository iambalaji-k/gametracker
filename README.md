# 🎮 CrossPlay - PC Game Tracker

A premium, modern web dashboard for tracking and organizing your PC game library across multiple gaming ecosystems (Steam, GOG, Epic Games, Legacy Games, and more). Built with a rich dark cyberpunk-themed interface, glassmorphism UI cards, and responsive sidebar navigation.

This repository is configured for a **fully online, single-user deployment** using **Vercel** and **Supabase**, completely replacing browser `localStorage` with a persistent cloud database for your games and configuration.

---

## ✨ Key Features

- 🎮 **Unified Dashboard**: Instantly track your total games, total hours played, completion ratio, and your most played game.
- 🚀 **Platform Badges**: Game thumbnails feature clean, hover-active badges using official vector SVGs representing their store (Steam, GOG, Epic Games, etc.), with custom brand-colored styling.
- 📆 **Clean Metadata**: Playtime hours are clearly labeled with a clock icon, and the repeating "Last Played" text is replaced by a sleek calendar icon next to the relative date.
- 🛠️ **Seamless Integrations**:
  - **Steam Sync**: Import your library using your Steam Custom Vanity URL or 17-digit Steam ID.
  - **GOG Sync**: Import GOG games using your GOG username.
  - **Smilegate STOVE Sync**: Import games directly using your STOVE Member Number or Profile URL.
  - **Itch.io Collection Sync**: Import and synchronize collections directly using public Itch collection URLs.
  - **Epic, Legacy & IndieGala Extractor**: Easy-to-use console scripts to scrape and import purchases and showcase collections directly.
  - **Supabase Cloud Sync**: Sync settings (Steam/GOG profiles, blacklists) and your game collection to a Postgres cloud database.
- 📝 **Edit Game Sidebar**: Full-featured slide-over drawer (using the sleek settings-panel design system) to edit game titles, platforms, playtimes, last played dates, vertical covers, and hero backdrops with live artwork previews and quick blacklist/delete controls.
- 🎨 **Smart Cover Art Standardization**: Automatic resolution and preservation of high-definition 600x900 vertical poster art (2:3 aspect ratio) and landscape hero banners across all platforms (Steam, GOG, Epic, Itch.io, STOVE, Ubisoft, IndieGala).
- 📊 **Dynamic Store-Filtered Hero Stats**: The hero section stats pill (Total Games and Playtime) dynamically updates based on the selected store/platform filter tab (Steam, GOG, Epic, Luna, Microsoft Store, Itch.io, STOVE, Ubisoft, IndieGala, etc.) while remaining unaffected by text search queries.
- 🔤 **Steam-Style Alphabetical Sorting**: Sorting alphabetically (A-Z / Z-A) ignores leading English articles (*"The"*, *"A"*, *"An"*) and applies natural numeric ordering, matching Steam library organization.
- 🔍 **Search & Filters**: Fast search matching along with tabbed platform filters (Steam, GOG, Epic, Legacy, Luna, Microsoft Store, Itch.io, Stove, Ubisoft, IndieGala, Other) and multiple sorting combinations.
- 🏷️ **Manual Entries**: Add custom games (e.g. Ubisoft, IndieGala, Amazon Gaming, Microsoft Store, Custom platforms) and resolve cover art from IGDB or Steam.
- 🎨 **Visual details**: Custom high-quality gamepad SVG favicon featuring the theme's Electric Violet to Cyber Cyan brand gradient, matching the app's dark-mode aesthetic.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                        BROWSER                         │
├────────────────────────────────────────────────────────┤
│   Static Frontend UI (HTML / CSS / Vanilla JS)         │
│   • Glassmorphism Dark Theme & Animated Glider Filter  │
│   • Local State & Resilient JSON Importers             │
└──────────────────────────┬─────────────────────────────┘
                           │
                    HTTP   │  /api/games/*
                  Requests │  /api/db/* (Secured Proxy)
                           ▼
┌────────────────────────────────────────────────────────┐
│               EXPRESS BACKEND SERVER                   │
├────────────────────────────────────────────────────────┤
│   • Steam API Resolvers & IGDB Metadata Search         │
│   • STOVE Scraper & Itch.io Crawler                    │
│   • Supabase Database Proxy (Secured Service/Anon Key) │
└──────────────────────────┬─────────────────────────────┘
                           │
                PostgreSQL │  REST API
                   Queries │  (Row-Level Security)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  SUPABASE CLOUD DB                     │
├────────────────────────────────────────────────────────┤
│   • 'games' Table (Multi-platform synced libraries)    │
│   • 'settings' Table (Single-user config & sync flags) │
└────────────────────────────────────────────────────────┘
```

- **Backend Proxy Security**: The client browser never communicates directly with Supabase or exposes credentials. All database read/write queries route through `/api/db/*`.
- **Zero LocalStorage Reliance for Cloud Users**: When Supabase is configured, games and settings are securely stored and synced to your cloud Postgres database. An automatic migration moves existing local storage data to Supabase on first startup.

---

## 🚀 Fully Online Deployment (Step-by-Step)

### 1. Database Setup (Supabase)
1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Navigate to the **SQL Editor** tab in the Supabase dashboard and click **New query**.
3. Copy the entire contents of [schema.sql](schema.sql), paste it into the editor, and click **Run**. This will create the `games` and `settings` tables and disable RLS for single-user access.
4. In **Project Settings** -> **API**, copy:
   - **Project URL**
   - **`anon` `public` API key** (Under *Publishable and secret API keys*)

### 2. Deploy to Vercel
1. Push your repository to a private or public GitHub repo.
2. Sign in to [vercel.com](https://vercel.com) using your GitHub account and import your repository.
3. Add the following **Environment Variables**:
   - `SUPABASE_URL` = *(Your Supabase Project URL)*
   - `SUPABASE_ANON_KEY` = *(Your Supabase Anon API key)*
   - `steam_web_api_key` = *(Your Steam Web API Key)*
   - `TWITCH_CLIENT_ID` = *(Your Twitch Developer Client ID)*
   - `TWITCH_CLIENT_SECRET` = *(Your Twitch Developer Client Secret)*
4. Click **Deploy**. Vercel will build and serve your app.
5. Opening your live URL for the first time will automatically migrate any legacy game data from `localStorage` directly to Supabase!

---

## 💻 Local Installation & Development

### Prerequisites
You will need [Node.js](https://nodejs.org/) installed.

### Setup
1. In the project directory, install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the root directory:
   ```env
   PORT=3000
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   steam_web_api_key=your_steam_web_api_key
   TWITCH_CLIENT_ID=your_twitch_client_id
   TWITCH_CLIENT_SECRET=your_twitch_client_secret
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to `http://localhost:3000`.

---

## 🛠️ User Integration Guidelines

### Steam
- Make sure your Steam Privacy settings for **Game Details** are set to **Public**.
- Go to **Settings** in CrossPlay, enter your Steam Username or Steam ID, and click **Apply** to resolve your profile.
- Click **Sync Steam** on the top bar to fetch your games.

### GOG.com
- Ensure your GOG profile privacy for **Profile & Games Library** is set to **Public**.
- Enter your GOG username in the settings page and click **Apply** to save.

### Smilegate STOVE
- Ensure your STOVE profile is public.
- Enter your **STOVE Member Number** or paste your full profile URL (e.g., `https://profile.onstove.com/en/123456789`) in the Settings panel and click **Apply**.
- Click **Sync STOVE** to fetch your games and DLC.

### Itch.io
- Create or open a public collection on your Itch.io profile containing your games.
- Copy your collection URL (e.g., `https://itch.io/c/1234567/my-collection`) and paste it in the Settings panel.
- Click **Sync Itch.io** to fetch and catalog your collection with vertical 600x900 cover artwork.

### Epic Games, Legacy Games & IndieGala
1. Log into your account portal transactions or library page.
2. Open developer console (**F12**).
3. Copy the extractor script from the CrossPlay settings panel (under Console Imports), paste it into the console, and press **Enter**.
4. Copy the resulting JSON string and paste it into the import input area in CrossPlay settings to import your games.

---

## 🧪 Testing

Run unit tests locally with:
```bash
npm test
```

---

## 📄 License
This project is open-source and available under the **MIT License**.
