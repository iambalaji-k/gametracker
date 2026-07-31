-- SQL Script for Supabase setup (Single-User Mode)
-- Go to your Supabase Dashboard -> SQL Editor, paste and run this query.

-- Create the games table to store synced game libraries from multiple platforms (Steam, GOG, etc.)
CREATE TABLE IF NOT EXISTS public.games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id TEXT NOT NULL,          -- Steam AppID, GOG Game ID, Epic Product ID, etc.
  platform TEXT NOT NULL,             -- 'Steam', 'GOG', 'Epic', etc.
  title TEXT NOT NULL,
  playtime_forever INTEGER DEFAULT 0, -- Store playtime in minutes
  last_played TIMESTAMP WITH TIME ZONE,
  cover_url TEXT,
  backdrop_url TEXT,                  -- Landscape hero/screenshot used for the top banner backdrop (Steam library_hero / IGDB screenshot)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (platform, external_id)     -- Prevents duplicate entries per platform
);

-- Create the settings table to store all app preferences (constrained to exactly one row)
CREATE TABLE IF NOT EXISTS public.settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  steam_id TEXT,
  vanity_url TEXT,
  gog_username TEXT,
  epic_connected BOOLEAN DEFAULT false,
  legacy_connected BOOLEAN DEFAULT false,
  stove_member_no TEXT,
  blacklist_app_ids JSONB DEFAULT '[]'::jsonb,
  blacklist_titles JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Disable Row Level Security (RLS) since it's a private single-user project.
-- This allows direct read/write access from the frontend via the Anon Key.
ALTER TABLE public.games DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings DISABLE ROW LEVEL SECURITY;
