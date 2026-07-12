-- SQL Script for Supabase setup
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (platform, external_id)      -- Prevents duplicate entries on a single platform
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- Create Policies to allow client-side sync
CREATE POLICY "Allow public read access" 
ON public.games FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert" 
ON public.games FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow public update" 
ON public.games FOR UPDATE 
USING (true);

CREATE POLICY "Allow public delete" 
ON public.games FOR DELETE 
USING (true);
