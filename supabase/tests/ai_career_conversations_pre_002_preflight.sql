-- READ-ONLY PRE-MIGRATION PREFLIGHT.
-- Run this selected script after migration 202610280001 and before considering
-- migration 202610280002. It does not apply migrations or change any data.
-- The result contains only a count, never conversation bodies or user IDs.

do $prerequisites$
begin
  if pg_catalog.to_regclass('public.assistant_conversations') is null then
    raise exception 'Missing public.assistant_conversations. Apply migration 202610280001 before running this preflight.';
  end if;
end;
$prerequisites$;

with invalid_rows as (
  select conversation.id
  from public.assistant_conversations as conversation
  where case when pg_catalog.jsonb_typeof(conversation.messages) = 'array' then
    pg_catalog.jsonb_array_length(conversation.messages) > 48
    or pg_catalog.octet_length(conversation.messages::text) > 131072
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(conversation.messages) = 'array'
          then conversation.messages else '[]'::jsonb end
      ) as item(value)
      where case when pg_catalog.jsonb_typeof(item.value) = 'object' then
        pg_catalog.jsonb_object_length(item.value) = 2
        and pg_catalog.jsonb_typeof(item.value -> 'role') = 'string'
        and item.value ->> 'role' in ('user', 'assistant')
        and pg_catalog.jsonb_typeof(item.value -> 'content') = 'string'
        and pg_catalog.char_length(item.value ->> 'content') <= 10000
      else false end is not true
    )
  else true end
)
select pg_catalog.count(*) as invalid_existing_conversation_count
from invalid_rows;
