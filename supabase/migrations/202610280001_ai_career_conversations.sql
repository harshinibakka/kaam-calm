begin;

create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  workflow_type text not null default 'career_chat' check (workflow_type = 'career_chat'),
  messages jsonb not null default '[]'::jsonb
    check (
      case when jsonb_typeof(messages) = 'array' then
        jsonb_array_length(messages) <= 48
        and octet_length(messages::text) <= 131072
      else false end
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_owner_updated_idx
  on public.assistant_conversations (user_id, updated_at desc);

create or replace function public.set_assistant_conversation_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_assistant_conversation_updated_at() from public, anon, authenticated;

drop trigger if exists assistant_conversations_set_updated_at on public.assistant_conversations;
create trigger assistant_conversations_set_updated_at
  before update on public.assistant_conversations
  for each row execute function public.set_assistant_conversation_updated_at();

alter table public.assistant_conversations enable row level security;

revoke all on table public.assistant_conversations from public, anon, authenticated;
grant select, insert, update, delete on table public.assistant_conversations to authenticated;

drop policy if exists "Users can read their own assistant conversations" on public.assistant_conversations;
create policy "Users can read their own assistant conversations"
  on public.assistant_conversations for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own assistant conversations" on public.assistant_conversations;
create policy "Users can create their own assistant conversations"
  on public.assistant_conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own assistant conversations" on public.assistant_conversations;
create policy "Users can update their own assistant conversations"
  on public.assistant_conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own assistant conversations" on public.assistant_conversations;
create policy "Users can delete their own assistant conversations"
  on public.assistant_conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

commit;
