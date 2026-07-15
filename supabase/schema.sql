-- NFL Pick'em: single picks table.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  player text not null check (player in ('dad', 'rich')),
  season int not null,
  week int not null,
  game_id text not null,
  picked_team_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player, season, week, game_id)
);

-- Keep updated_at fresh on upsert.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger picks_set_updated_at
  before update on public.picks
  for each row
  execute function public.set_updated_at();

-- RLS: the app only ever uses the anon key, and only needs the picks table.
-- Allow anon to read/insert/update picks (no delete).
alter table public.picks enable row level security;

create policy "anon read picks"
  on public.picks for select
  to anon
  using (true);

create policy "anon insert picks"
  on public.picks for insert
  to anon
  with check (player in ('dad', 'rich'));

create policy "anon update picks"
  on public.picks for update
  to anon
  using (true)
  with check (player in ('dad', 'rich'));
