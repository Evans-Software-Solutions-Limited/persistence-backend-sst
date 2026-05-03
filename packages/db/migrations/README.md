# DB migrations

The runtime DB is **Supabase Postgres**, not a Drizzle-managed Neon instance. `packages/db/src/schema.ts` is the application's view of the schema and must mirror what's actually in Supabase.

## How a schema change ships

1. Add the column / table / index / constraint to `packages/db/src/schema.ts`.
2. Author a new file in this directory: `NNNN_<short-description>.sql`. Number sequentially (`0001_`, `0002_`, …) so the order is unambiguous on disk.
3. Use idempotent DDL — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc. Re-runs must be safe.
4. Apply against Supabase via the Supabase SQL editor, the `psql` direct connection, or `supabase db push` if/when the local Supabase CLI flow is wired. The runtime client (Lambda) does not run migrations.
5. Mention the migration filename in the PR description so reviewers can verify it ran against staging before merge.

## Why no automated runner

Lambda cold starts can't carry migration responsibility — `getDb()` is a per-cold-start singleton over the Supabase Transaction-mode pooler (see `packages/db/src/client.ts`), and running ALTER TABLE inside that path would race across concurrent invocations. Schema changes are an operator action, not a runtime one.

If we adopt `drizzle-kit migrate` later, the files in this folder become the seed input for the generator — keeping the SQL hand-written and idempotent now means the path forward stays clean.
