begin;

-- Validate the exact message shape expected by the client. The initial
-- migration bounds row size and count; this follow-up also bounds each item.
create or replace function public.assistant_conversation_messages_valid(p_messages jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case when pg_catalog.jsonb_typeof(p_messages) = 'array' then
    pg_catalog.jsonb_array_length(p_messages) <= 48
    and pg_catalog.octet_length(p_messages::text) <= 131072
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_messages) as item(value)
      where case when pg_catalog.jsonb_typeof(item.value) = 'object' then
      (
  select count(*) = 2
  from pg_catalog.jsonb_object_keys(item.value)
)
        and pg_catalog.jsonb_typeof(item.value -> 'role') = 'string'
        and item.value ->> 'role' in ('user', 'assistant')
        and pg_catalog.jsonb_typeof(item.value -> 'content') = 'string'
        and pg_catalog.char_length(item.value ->> 'content') <= 10000
      else false end is not true
    )
  else false end;
$$;

revoke all on function public.assistant_conversation_messages_valid(jsonb) from public, anon;
grant execute on function public.assistant_conversation_messages_valid(jsonb) to authenticated;

alter table public.assistant_conversations
  drop constraint if exists assistant_conversations_messages_check;

alter table public.assistant_conversations
  add constraint assistant_conversations_messages_valid
  check (public.assistant_conversation_messages_valid(messages));

-- Serialize inserts per owner, then retain only the newest 49 existing rows
-- before the new row is inserted. The lock is transaction-scoped, so concurrent
-- inserts for the same owner cannot both pass a stale count and exceed 50.
create or replace function public.enforce_assistant_conversation_retention()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  owner_id uuid;
begin
  owner_id := auth.uid();
  if owner_id is null or new.user_id is distinct from owner_id then
    raise exception 'Authenticated owner is required for assistant conversations'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));

  -- Keep timestamps server-controlled so clients cannot pin old rows in history.
  new.created_at := pg_catalog.now();
  new.updated_at := new.created_at;

  delete from public.assistant_conversations as conversation
  where conversation.id in (
    select existing.id
    from public.assistant_conversations as existing
    where existing.user_id = owner_id
    order by existing.updated_at desc, existing.id desc
    offset 49
  );

  return new;
end;
$$;

revoke all on function public.enforce_assistant_conversation_retention() from public, anon, authenticated;

drop trigger if exists assistant_conversations_enforce_retention on public.assistant_conversations;
create trigger assistant_conversations_enforce_retention
  before insert on public.assistant_conversations
  for each row execute function public.enforce_assistant_conversation_retention();

-- Keep the owner, primary key, and timestamps controlled by defaults/triggers.
-- RLS still determines which rows can be read, updated, or deleted.
revoke insert, update on table public.assistant_conversations from authenticated;
grant insert (title, workflow_type, messages) on table public.assistant_conversations to authenticated;
grant update (title, workflow_type, messages) on table public.assistant_conversations to authenticated;

commit;
