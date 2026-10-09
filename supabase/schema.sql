-- Cole tudo isto no Supabase: SQL Editor > New query > Run

create table foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  unit text not null default '',
  protein numeric not null,
  created_at timestamptz not null default now()
);

create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  name text not null,
  protein numeric not null default 0,
  created_at timestamptz not null default now()
);

create table weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  kg numeric not null,
  created_at timestamptz not null default now()
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table checklist_done (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references checklist_items on delete cascade,
  day date not null,
  primary key (user_id, item_id, day)
);

-- Cada pessoa só enxerga e altera os próprios dados
alter table foods enable row level security;
alter table meals enable row level security;
alter table weights enable row level security;
alter table checklist_items enable row level security;
alter table checklist_done enable row level security;

create policy "own" on foods for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own" on meals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own" on weights for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own" on checklist_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own" on checklist_done for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on meals (user_id, day);
create index on weights (user_id, day);
