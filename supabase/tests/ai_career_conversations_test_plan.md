# AI Career conversation-history database test plan

**Review only.** Nothing in this plan or the companion SQL file applies migrations. Run database checks only against a disposable development Supabase project after confirming its project identity in the dashboard. Do not run the tests against production.

## Source findings and prerequisites

- Apply `202610280001_ai_career_conversations.sql` before `202610280002_harden_ai_career_conversations.sql`.
- The first migration creates `public.assistant_conversations`, its owner/update-time index and update trigger, enables RLS, grants authenticated CRUD, and adds owner-only SELECT/INSERT/UPDATE/DELETE policies.
- The follow-up replaces the original `messages` check with a JSON shape validator, adds an insert-retention trigger and owner advisory lock, and limits authenticated INSERT/UPDATE to `title`, `workflow_type`, and `messages`.
- The repository has no earlier migration creating `assistant_conversations`. Still check the target database before applying: `CREATE TABLE IF NOT EXISTS` does not reconcile an existing table with a different shape.
- Applying both migrations to a new, unused disposable database avoids existing conversation rows. If migration 001 has already been applied and rows exist, run `ai_career_conversations_pre_002_preflight.sql` before migration 002. The new constraint scans existing rows; malformed rows cause the follow-up migration to fail and roll back. Do not silently delete or rewrite them.
- The cap assumes database transactions use `READ COMMITTED`, so a transaction waiting for the per-owner advisory lock sees the previous insert after the wait. Confirm the actual isolation used for authenticated PostgREST writes. Test the trigger through an authenticated session: the retention function is invoker-rights and its pruning DELETE must pass the authenticated role’s DELETE grant and owner RLS policy.
- The SQL uses PostgreSQL JSONB functions and `hashtextextended`/`pg_advisory_xact_lock(bigint)`. Confirm the target PostgreSQL version supports them. `auth.uid()` must resolve to the authenticated test user in real JWT-backed requests; do not simulate it by setting a claimed user ID in a SQL session.
- The frontend sends only `title`, `workflow_type`, and `messages` on insert/update, selects columns granted to authenticated, and uses `DELETE ... RETURNING id` to confirm deletion. Job cards are transient and are not part of the persisted message shape.

## Checklist

For every run, use a disposable development project and dedicated test accounts. Record the migration versions, PostgreSQL/PostgREST isolation setting, test account labels (not tokens), query results, and any SQLSTATE/error names. Do not save message bodies, JWTs, or other personal data in the evidence.

### 1. Preflight and migration order

- **Preconditions:** disposable project identity verified; no production connection; migration files reviewed; dedicated test users available for later tests.
- **Steps:** inspect whether `public.assistant_conversations` already exists and compare its columns, constraints, triggers, grants, and policies with migration 001. If absent, apply 001 then 002 using the normal migration workflow. If 001 is already present with rows, run `ai_career_conversations_pre_002_preflight.sql` by itself before applying 002. It requires migration 001’s table and reports a clear prerequisite error if the table is absent.
- **Expected:** migrations apply in filename order without an existing-object mismatch. The preflight count is zero before adding the follow-up constraint. If it is nonzero, stop and review those rows before applying 002.
- **Evidence:** migration history, schema-inspection output, preflight count, and successful/failed migration status.
- **Cleanup:** no cleanup for schema checks. If a disposable database was created solely for this test, remove it only through the appropriate project-management workflow after review; never drop objects from a shared or production project.

### 2. Valid owner operations

- **Preconditions:** both migrations applied; two dedicated, confirmed users, A and B; valid authenticated sessions for each.
- **Steps:** as A, insert a valid career-chat record without supplying `id`, `user_id`, or timestamps; list and load it; update title/messages; delete it. Repeat a separate valid insert/list/load/update/delete cycle as B.
- **Expected:** defaults set the ID, owner, and timestamps; each user sees their own row; valid updates persist; deletion returns the deleted ID to that owner only.
- **Evidence:** row counts and returned IDs per test account, plus timestamps and update results. Avoid recording message text or credentials.
- **Cleanup:** use only these dedicated accounts and their test rows. After evidence review, delete the dedicated accounts through the disposable project’s Auth administration UI (the FK cascades only their rows), or delete only recorded test IDs while authenticated as the owning test user.

### 3. Message/count/content/byte boundaries

- **Preconditions:** both migrations applied; use the read-only validator queries in `ai_career_conversations_test.sql`. That post-migration script checks for the table and validator function first and gives migration-order instructions if either is missing. Authenticated table-boundary inserts, if desired, must be made using real test-user sessions in a rollback-safe transaction where supported.
- **Steps:** exercise valid 48-message arrays, 10,000-character content, and JSONB serialization exactly at 131,072 bytes; then 49 messages, 10,001 characters, and a payload one byte over 131,072. Also test invalid role, non-string content, missing/extra keys, and a non-array top-level value.
- **Expected:** the exact count, content, and byte boundaries pass; invalid shape and over-limit values fail the table constraint. The companion’s pure validator calls are read-only and test the function, not the full table/RLS path.
- **Evidence:** each case label, expected/actual validator result, and SQLSTATE for table writes. Do not include test content in logs.
- **Cleanup:** rollback any suitable transaction. Otherwise delete only dedicated test rows as their owner; never use broad deletes.

### 4. Cross-owner RLS checks

- **Preconditions:** two real Supabase users, A and B, each with a row created via a real authenticated session; no mocked JWT claims or arbitrary `auth.uid()` substitution.
- **Steps:** as A, list and load A’s row; attempt to load, update, and delete B’s known test ID. Repeat symmetrically as B. Attempt to insert a row naming the other user as owner.
- **Expected:** each user reads only own rows. Cross-owner update/delete affects no row; cross-owner load and delete return no row; cross-owner insert is denied by column privileges and/or RLS. Responses must not distinguish another user’s row from a missing row.
- **Evidence:** returned row counts, affected-row counts, and generic error/status classes only.
- **Cleanup:** remove only the two dedicated users or their own recorded rows.

### 5. Protected columns and timestamps

- **Preconditions:** authenticated user A and a disposable row owned by A.
- **Steps:** attempt insert/update payloads specifying `id`, `user_id`, `created_at`, or `updated_at`; then perform normal permitted insert/update fields. Compare timestamps before and after a successful update.
- **Expected:** direct protected-column writes are denied by column grants. Insert defaults and the retention trigger set owner/creation timestamps; the update trigger advances `updated_at`. Normal title/workflow/messages writes continue to work.
- **Evidence:** SQLSTATE/permission errors for denied columns; returned row IDs and timestamp comparison for allowed operations.
- **Cleanup:** remove only A’s test row as A.

### 6. Cap, pruning, and concurrent inserts

- **Preconditions:** dedicated owner A; exactly 50 disposable conversations for A, with distinguishable creation/update order; confirm the PostgREST transaction isolation and use two independent authenticated connections/sessions.
- **Steps:** update selected older rows so their `updated_at` ordering is known. Concurrently insert at least two new rows for A from separate connections. After both commit, list/count A’s rows and inspect only test IDs. Also verify a row owned by B is unaffected.
- **Expected:** successful inserts serialize on the owner-keyed transaction advisory lock; the final count for A is at most 50; pruning removes only A’s least-recently-updated rows, retaining recently updated rows; B’s rows are unchanged. A failed insert must not leave pruning side effects committed.
- **Evidence:** isolation level, start/commit order, final per-owner counts, IDs pruned/retained, and outcomes of each request. The single-session SQL companion cannot prove this concurrency property.
- **Cleanup:** delete only the dedicated test accounts or their recorded test rows.

### 7. Trigger execution privileges and RLS during pruning

- **Preconditions:** authenticated owner A with more than 49 existing rows, achievable only as controlled test setup in the disposable database; use the same role/path as the frontend.
- **Steps:** insert the next conversation through the authenticated Supabase client/PostgREST path. Do not run it as a database owner and do not manually invoke the trigger function as a substitute.
- **Expected:** the trigger fires despite its direct EXECUTE privilege being revoked from authenticated; its invoker-rights DELETE succeeds under A’s table DELETE grant and owner RLS policy. Only A’s oldest excess rows are pruned.
- **Evidence:** insert response, final A row count, and B’s unchanged row count.
- **Cleanup:** remove only A/B test accounts or recorded test data.

### 8. Missing/inaccessible deletion

- **Preconditions:** authenticated A and a known ID that is either absent or belongs to B.
- **Steps:** call the same delete-and-return-ID operation used by the frontend for each ID.
- **Expected:** no returned ID and no error detail that identifies whether B owns the row. The UI must present its generic unavailable state rather than claim a confirmed deletion.
- **Evidence:** returned-row presence/absence and generic UI result; do not disclose B’s row existence.
- **Cleanup:** none beyond the normal dedicated-user cleanup.

### 9. Existing-row compatibility before migration 002

- **Preconditions:** migration 001 applied and rows may exist; do not apply migration 002 until this check is reviewed.
- **Steps:** run `ai_career_conversations_pre_002_preflight.sql`, then validate any suspicious records using the shape rules in migration 002 without printing message bodies. Do not modify rows as part of this test.
- **Expected:** zero invalid rows. If invalid rows exist, stop and decide on a reviewed, owner-safe remediation plan before applying 002; the migration’s `ADD CONSTRAINT` is expected to fail rather than accept invalid existing data.
- **Evidence:** invalid-row count and reviewed remediation decision only.
- **Cleanup:** none; the preflight is read-only.

## Companion script limitations

Use `ai_career_conversations_pre_002_preflight.sql` only after migration 001 and before migration 002. It checks the table prerequisite and returns only a count of existing rows that would fail the new constraint. Use `ai_career_conversations_test.sql` only after both migrations; its initial prerequisite block checks for both the table and validator function before running catalog and validator checks.

Both SQL files are read-only. The post-migration script contains catalog queries and calls to the immutable message validator; the preflight reads message JSON internally but returns only a count, not message bodies or user IDs. Neither script inserts rows, emulates a Supabase user, proves RLS, exercises trigger privileges through PostgREST, tests column grants through authenticated requests, or tests concurrency. Those require the real authenticated/manual checks above in the disposable development project.
