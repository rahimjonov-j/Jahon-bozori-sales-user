create table if not exists public.shop_statuses (
  shop_id text primary key,
  status text not null check (status in ('available', 'reserved', 'sold')),
  source_text text,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists shop_statuses_status_idx
  on public.shop_statuses (status);

alter table public.shop_statuses replica identity full;
