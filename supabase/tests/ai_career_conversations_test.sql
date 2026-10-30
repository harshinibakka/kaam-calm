-- READ-ONLY POST-MIGRATION TEST SCRIPT.
-- Requires both conversation migrations on a disposable development database.
-- For the migration-001-only preflight before migration 002, use
-- ai_career_conversations_pre_002_preflight.sql instead.
-- This script contains no DML/DDL, role changes, RLS changes, or remote
-- connection commands. It does not replace authenticated or concurrency tests.

-- Fail early with actionable instructions instead of an undefined-table or
-- undefined-function error. This guard only reads PostgreSQL catalogs.
do $prerequisites$
begin
  if pg_catalog.to_regclass('public.assistant_conversations') is null then
    raise exception 'Missing public.assistant_conversations. Apply migration 202610280001 first, then 202610280002; use the pre-002 preflight script only after migration 001.';
  end if;
  if pg_catalog.to_regprocedure('public.assistant_conversation_messages_valid(jsonb)') is null then
    raise exception 'Missing public.assistant_conversation_messages_valid(jsonb). Apply migration 202610280002 before running this post-migration test script.';
  end if;
end;
$prerequisites$;

-- SECTION A: read-only schema inventory. Requires both migrations above.
select constraint_row.conname, pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
from pg_catalog.pg_constraint as constraint_row
where constraint_row.conrelid = 'public.assistant_conversations'::regclass
order by constraint_row.conname;

select index_row.indexname, index_row.indexdef
from pg_catalog.pg_indexes as index_row
where index_row.schemaname = 'public'
  and index_row.tablename = 'assistant_conversations'
order by index_row.indexname;

select policy.policyname, policy.command, policy.roles, policy.qual, policy.with_check
from pg_catalog.pg_policies as policy
where policy.schemaname = 'public'
  and policy.tablename = 'assistant_conversations'
order by policy.command, policy.policyname;

select grant_row.grantee, grant_row.privilege_type
from information_schema.role_table_grants as grant_row
where grant_row.table_schema = 'public'
  and grant_row.table_name = 'assistant_conversations'
  and grant_row.grantee in ('anon', 'authenticated', 'public')
order by grant_row.grantee, grant_row.privilege_type;

select grant_row.grantee, grant_row.column_name, grant_row.privilege_type
from information_schema.role_column_grants as grant_row
where grant_row.table_schema = 'public'
  and grant_row.table_name = 'assistant_conversations'
  and grant_row.grantee in ('anon', 'authenticated', 'public')
order by grant_row.grantee, grant_row.column_name, grant_row.privilege_type;

select trigger_row.tgname, pg_catalog.pg_get_triggerdef(trigger_row.oid) as definition
from pg_catalog.pg_trigger as trigger_row
where trigger_row.tgrelid = 'public.assistant_conversations'::regclass
  and not trigger_row.tgisinternal
order by trigger_row.tgname;

select function_row.oid::regprocedure as function_signature,
       function_row.prosecdef as security_definer,
       function_row.provolatile as volatility,
       function_row.proconfig as function_settings,
       function_row.proacl as function_acl
from pg_catalog.pg_proc as function_row
join pg_catalog.pg_namespace as namespace_row on namespace_row.oid = function_row.pronamespace
where namespace_row.nspname = 'public'
  and function_row.proname in (
    'set_assistant_conversation_updated_at',
    'assistant_conversation_messages_valid',
    'enforce_assistant_conversation_retention'
  )
order by function_row.proname;

select relation.relrowsecurity as rls_enabled,
       relation.relforcerowsecurity as force_rls,
       pg_catalog.has_table_privilege('authenticated', 'public.assistant_conversations', 'SELECT') as authenticated_can_select,
       pg_catalog.has_table_privilege('authenticated', 'public.assistant_conversations', 'DELETE') as authenticated_can_delete,
       pg_catalog.has_table_privilege('authenticated', 'public.assistant_conversations', 'INSERT') as authenticated_has_table_insert,
       pg_catalog.has_table_privilege('authenticated', 'public.assistant_conversations', 'UPDATE') as authenticated_has_table_update,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'title', 'INSERT') as authenticated_can_insert_title,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'title', 'UPDATE') as authenticated_can_update_title,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'workflow_type', 'INSERT') as authenticated_can_insert_workflow_type,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'workflow_type', 'UPDATE') as authenticated_can_update_workflow_type,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'messages', 'INSERT') as authenticated_can_insert_messages,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'messages', 'UPDATE') as authenticated_can_update_messages,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'id', 'INSERT') as authenticated_can_insert_id,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'user_id', 'INSERT') as authenticated_can_insert_user_id,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'created_at', 'INSERT') as authenticated_can_insert_created_at,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'updated_at', 'INSERT') as authenticated_can_insert_updated_at,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'id', 'UPDATE') as authenticated_can_update_id,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'user_id', 'UPDATE') as authenticated_can_update_user_id,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'created_at', 'UPDATE') as authenticated_can_update_created_at,
       pg_catalog.has_column_privilege('authenticated', 'public.assistant_conversations', 'updated_at', 'UPDATE') as authenticated_can_update_updated_at
from pg_catalog.pg_class as relation
join pg_catalog.pg_namespace as schema_row on schema_row.oid = relation.relnamespace
where schema_row.nspname = 'public'
  and relation.relname = 'assistant_conversations';

-- SECTION C: read-only unit cases for the immutable validator function.
-- These calls do not insert rows or simulate an authenticated session.
with cases(test_name, payload, expected_valid) as (
  values
    ('valid one-message transcript', '[{"role":"user","content":"hello"}]'::jsonb, true),
    ('valid 48-message transcript', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('role', case when sequence.number % 2 = 0 then 'assistant' else 'user' end, 'content', 'ok')
        order by sequence.number
      )
      from pg_catalog.generate_series(1, 48) as sequence(number)
    ), true),
    ('invalid role', '[{"role":"system","content":"no"}]'::jsonb, false),
    ('non-string content', '[{"role":"user","content":7}]'::jsonb, false),
    ('extra key', '[{"role":"user","content":"ok","token":"redacted"}]'::jsonb, false),
    ('missing key', '[{"role":"user"}]'::jsonb, false),
    ('10,000-character content', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('role', 'user', 'content', pg_catalog.repeat('x', 10000))), true),
    ('10,001-character content', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('role', 'user', 'content', pg_catalog.repeat('x', 10001))), false),
    ('49 messages', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role', 'user', 'content', 'x') order by sequence.number)
      from pg_catalog.generate_series(1, 49) as sequence(number)
    ), false),
    ('non-array top-level value', '{"role":"user","content":"no"}'::jsonb, false)
)
select test_name,
       expected_valid,
       public.assistant_conversation_messages_valid(payload) as actual_valid,
       public.assistant_conversation_messages_valid(payload) = expected_valid as passed
from cases
order by test_name;

-- Construct valid-shaped JSONB exactly at the serialized byte boundary, then
-- one byte over it. This checks JSONB's actual text serialization, not an
-- assumed JSON.stringify size. All individual messages remain <= 10,000 chars.
with base as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('role', 'user', 'content', case when sequence.number <= 13 then pg_catalog.repeat('x', 10000) else '' end)
    order by sequence.number
  ) as payload
  from pg_catalog.generate_series(1, 14) as sequence(number)
), boundary as (
  select pg_catalog.jsonb_set(
    payload,
    '{13,content}',
    pg_catalog.to_jsonb(pg_catalog.repeat('x', 131072 - pg_catalog.octet_length(payload::text)))
  ) as exact_payload
  from base
), cases(test_name, payload, expected_bytes, expected_valid) as (
  select 'exactly 131,072 serialized bytes', exact_payload, 131072, true from boundary
  union all
  select '131,073 serialized bytes',
         pg_catalog.jsonb_set(exact_payload, '{13,content}', pg_catalog.to_jsonb((exact_payload -> 13 ->> 'content') || 'x')),
         131073,
         false
  from boundary
)
select test_name,
       pg_catalog.octet_length(payload::text) as actual_bytes,
       expected_bytes,
       public.assistant_conversation_messages_valid(payload) as actual_valid,
       expected_valid,
       pg_catalog.octet_length(payload::text) = expected_bytes
         and public.assistant_conversation_messages_valid(payload) = expected_valid as passed
from cases
order by test_name;

-- Manual-only cases are intentionally not automated here: real authenticated
-- JWT sessions, two users, RLS-protected DML, trigger pruning privileges, and
-- simultaneous independent connections are required. See the companion plan.
