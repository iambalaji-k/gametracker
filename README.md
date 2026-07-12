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
  - **Epic & Legacy Games Extractor**: Easy-to-use console scripts to scrape and import purchases directly.
  - **Supabase Cloud Sync**: Sync settings (Steam/GOG profiles, blacklists) and your game collection to a Postgres cloud database.
- 🔍 **Search & Filters**: Fast search matching along with tabbed platform filters (Steam, GOG, Epic, Legacy, Other) and multiple sorting combinations.
- 🏷️ **Manual Entries**: Add custom games (e.g. Amazon Gaming, Microsoft Store, Custom platforms) and resolve cover art from IGDB or Steam.
- 🎨 **Visual details**: Custom high-quality gamepad SVG favicon featuring the theme's Electric Violet to Cyber Cyan brand gradient, matching the app's dark-mode aesthetic.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                        BROWSER                         │
├──────────────────────────┬─────────────────────────────┤
│   Static Frontend UI     │   Supabase Client Library   │
│   (HTML/CSS/JS Assets)   │   (Direct DB Read/Write)    │
└────────────┬─────────────┴──────────────▲──────────────┘
             │                            │
      HTTP   │                            │  PostgreSQL Queries
    Requests │                            │  (Anon Key)
             ▼                            ▼
┌──────────────────────────┐   ┌─────────────────────────┐
│     VERCEL SERVERLESS    │   │        SUPABASE         │
├──────────────────────────┤   ├─────────────────────────┤
│    Express.js Server     │   │  Postgres Cloud DB      │
│   • Steam API Resolvers  │   │  • 'games' Table        │
│   • GOG Profile Scraper  │   │  • 'settings' Table     │
│   • IGDB Metadata API    │   │                         │
└──────────────────────────┘   └─────────────────────────┘
```

- **Serverless Backend (Vercel)**: Serves static files and hosts API endpoints to interact with Steam, GOG, and Twitch/IGDB APIs using secret credentials kept hidden from the client browser.
- **Client-Side Database Operations (Supabase)**: The frontend connects directly to Supabase using the Anon Key to fetch/save your library and settings.
- **Zero LocalStorage reliance**: Settings, profiles, and blacklists are saved in a single-row `settings` table on Supabase, making the application fully cross-device sync-ready. An automatic migration moves existing `localStorage` data to Supabase on first startup.

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

### Epic Games & Legacy Games
1. Log into your account portal transactions page.
2. Open developer console (**F12**).
3. Copy the scraper script from the CrossPlay settings panel, paste it into the console, and hit enter.
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
