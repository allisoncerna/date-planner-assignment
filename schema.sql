-- ==========================================================================
-- Date Night Planner — Supabase schema
-- Run this in the Supabase dashboard: SQL Editor → New query → Run.
-- ==========================================================================

create table if not exists public.dates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  category     text not null check (char_length(category) between 1 and 40),
  status       text not null default 'Wishlist' check (status in ('Wishlist', 'Maybe', 'Definite')),
  is_completed boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists dates_user_id_created_at_idx
  on public.dates (user_id, created_at desc);

-- --------------------------------------------------------------------------
-- Row Level Security: each user can only see and change their own rows.
-- --------------------------------------------------------------------------
alter table public.dates enable row level security;

drop policy if exists "Users can read their own dates"   on public.dates;
drop policy if exists "Users can insert their own dates" on public.dates;
drop policy if exists "Users can update their own dates" on public.dates;
drop policy if exists "Users can delete their own dates" on public.dates;

create policy "Users can read their own dates"
  on public.dates for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own dates"
  on public.dates for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own dates"
  on public.dates for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own dates"
  on public.dates for delete
  to authenticated
  using ((select auth.uid()) = user_id);
