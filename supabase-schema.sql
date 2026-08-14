-- supabase-schema.sql
-- Reconciled against the live schema on project vsijljezyvhmfmbefhlw
-- (mrrossrogers's Project) as of 2026-08-13. This file previously only
-- covered fsa_articles; fsa_content_candidates existed live but was never
-- reflected here. Both tables, their trigger, and RLS are captured below.

-- ── fsa_articles ─────────────────────────────────────────────────────────
-- One row per article moving through the gauntlet.
create table if not exists public.fsa_articles (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('food', 'sex', 'alcohol')),
  seed text not null,
  angle text,
  issue text not null default 'current',
  status text not null default 'submitted',
  brief jsonb,
  draft text,
  draft_round integer not null default 0,
  image_brief jsonb,
  image_url text,
  image_round integer not null default 0,
  critique_log jsonb not null default '[]'::jsonb,
  final_decision text,
  final_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── fsa_content_candidates ──────────────────────────────────────────────
-- Content Funnel staging table. Approving a candidate inserts a row into
-- fsa_articles (status: submitted) and links back here via approved_article_id.
create table if not exists public.fsa_content_candidates (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('food', 'sex', 'alcohol')),
  seed text not null,
  angle text,
  source text not null default 'manual',
  issue text not null default 'current',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_article_id uuid references public.fsa_articles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── updated_at trigger ──────────────────────────────────────────────────
create or replace function public.fsa_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fsa_articles_touch on public.fsa_articles;
create trigger fsa_articles_touch
  before update on public.fsa_articles
  for each row execute function public.fsa_touch_updated_at();

drop trigger if exists fsa_candidates_touch on public.fsa_content_candidates;
create trigger fsa_candidates_touch
  before update on public.fsa_content_candidates
  for each row execute function public.fsa_touch_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────
-- All access to these tables goes through the Vercel API using the
-- service-role key (SUPABASE_SERVICE_KEY), which bypasses RLS entirely.
-- RLS is enabled here with no policies, which blocks the anon/publishable
-- key from reading or writing these tables directly — nothing in this app
-- relies on client-side Supabase access, so this has no functional effect
-- beyond closing that hole.
alter table public.fsa_articles enable row level security;
alter table public.fsa_content_candidates enable row level security;
