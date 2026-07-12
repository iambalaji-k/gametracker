# CrossPlay - PC Game Tracker

A premium, modern web dashboard for tracking and organizing your PC game library across multiple gaming ecosystems (Steam, GOG, Epic Games, Legacy Games, and more). Built with a rich dark cyberpunk-themed interface, glassmorphism UI cards, and responsive sidebar navigation.

---

## Key Features

- 🎮 **Unified Dashboard**: Instantly track your total games, total hours played, completion ratio, and your most played game.
- 🚀 **Platform Badges**: Game thumbnails feature clean, hover-active badges using official vector SVGs representing their store (Steam, GOG, Epic Games, etc.), with custom brand-colored styling.
- 📆 **Clean Metadata**: Playtime hours are clearly labeled with a clock icon, and the repeating "Last Played" text is replaced by a sleek calendar icon next to the relative date.
- 🛠️ **Seamless Integrations**:
  - **Steam Sync**: Import your library using your Steam Custom Vanity URL or 17-digit Steam ID.
  - **GOG Sync**: Import GOG games using your GOG username.
  - **Epic & Legacy Games Extractor**: Easy-to-use console scripts to scrape and import purchases directly.
  - **Supabase Cloud Sync**: Optionally sync your collection to a cloud database automatically.
- 🔍 **Search & Filters**: Fast search matching along with tabbed platform filters (Steam, GOG, Epic, Legacy, Other) and multiple sorting combinations.
- 🏷️ **Manual Entries**: Add custom games (e.g. Amazon Gaming, Microsoft Store, Custom platforms) and resolve cover art from IGDB or Steam.

---

## Technical Stack

- **Frontend**: Vanilla HTML5, CSS3 variables, and Javascript (ES Modules). Uses [Lucide Icons](https://lucide.dev/) for crisp vector symbols.
- **Backend**: [Express.js](https://expressjs.com/) server with environment variable handling.
- **Database (Optional)**: [Supabase](https://supabase.com/) for cloud synchronization.
- **Metadata Fallback**: Twitch/IGDB API and Steam Grid fallback endpoints to resolve game details and vertical covers.

---

## Getting Started

### Prerequisites

You will need [Node.js](https://nodejs.org/) installed.

### Installation

1. Clone or download the repository to your local machine.
2. In the project directory, install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory (refer to the environment setup section below).
4. Run the development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:3000`.

### Environment Configuration

To enable fallback search and covers via the Twitch/IGDB API, configure your `.env` file:

```env
PORT=3000
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret
```

---

## User Integration Guidelines

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
4. Copy the resulting JSON string and paste it into the input area in CrossPlay settings to import your games.

---

## Database Schema (Supabase)

If you enable Supabase Sync, make sure to execute the SQL definitions in your Supabase SQL Editor. The schema can be found in [schema.sql](file:///D:/Vibe%20Coding/gametracker/schema.sql):

```sql
-- Schema version 1.0
CREATE TABLE IF NOT EXISTS games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  cover_url TEXT,
  playtime_forever INTEGER DEFAULT 0,
  rtime_last_played INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_game_per_platform UNIQUE (external_id, platform)
);
```

---

## License

This project is open-source and available under the MIT License.
