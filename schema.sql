-- SQL Script for Supabase setup
-- Go to your Supabase Dashboard -> SQL Editor, paste and run this query.

-- Create the games table to store synced game libraries from multiple platforms (Steam, GOG, etc.)
CREATE TABLE IF NOT EXISTS public.games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(), -- owner of the row
  external_id TEXT NOT NULL,          -- Steam AppID, GOG Game ID, Epic Product ID, etc.
  platform TEXT NOT NULL,             -- 'Steam', 'GOG', 'Epic', etc.
  title TEXT NOT NULL,
  playtime_forever INTEGER DEFAULT 0, -- Store playtime in minutes
  last_played TIMESTAMP WITH TIME ZONE,
  cover_url TEXT,
  backdrop_url TEXT, -- Landscape hero/screenshot used for the top banner backdrop (Steam library_hero / IGDB screenshot)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (user_id, platform, external_id) -- Prevents duplicate entries per user per platform
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- For an EXISTING table that was created before backdrop_url existed, run:
--   ALTER TABLE public.games ADD COLUMN IF NOT EXISTS backdrop_url TEXT;

-- Row-level policies: each user can only see and modify their own rows.
-- (If you run this on an existing table, drop the old public policies first:
--   DROP POLICY IF EXISTS "Allow public read access" ON public.games;
--   DROP POLICY IF EXISTS "Allow public insert"   ON public.games;
--   DROP POLICY IF EXISTS "Allow public update"   ON public.games;
--   DROP POLICY IF EXISTS "Allow public delete"   ON public.games;
-- )

CREATE POLICY "Users can read their own games"
ON public.games FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own games"
ON public.games FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own games"
ON public.games FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own games"
ON public.games FOR DELETE
USING (auth.uid() = user_id);
