import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Get the database URL from SST Resource or environment variable.
 * At runtime, SST injects Resource values into the Lambda environment.
 */
function getDatabaseUrl(): string {
  // Try to get from Resource (SST runtime)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require("sst");
    if (Resource.PersistenceDatabaseUrl?.value) {
      return Resource.PersistenceDatabaseUrl.value;
    }
  } catch {
    // Resource not available, fall through to env var
  }

  // Fall back to environment variable
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it via: sst secret set PersistenceDatabaseUrl <url>",
    );
  }
  return url;
}

/**
 * Per-container connection ceiling. **Must be >= 2.**
 *
 * ## What was measured (2026-07-29, against staging)
 *
 * At `max: 1`, the four reads `POST /workouts/:id/loadout/preview` fires under
 * `Promise.all` deadlock. Reproduced with the real repository methods and the
 * real client, fresh process each time:
 *
 *     max: 4   ->  4/4 resolved (487, 148, 134, 146 ms)
 *     max: 1   ->  first run resolved, then 3/3 HUNG
 *
 * Two of those four reads return 17 and 29 rows. Synthetic runs put the boundary
 * between 3 and 4 concurrent multi-row queries, and `max: 2` was already enough
 * to clear it.
 *
 * What it cost: that endpoint had **never once succeeded** — 7 calls over 30
 * days, 0 x 200, every one a 29 s Lambda timeout with no application logs, no
 * thrown error and no Bedrock invocation. The hung queries never reach Postgres,
 * so `pg_stat_statements` cannot see them either: absence of a slow query is not
 * absence of a hung one. It was diagnosed twice as an AI/timeout problem first.
 *
 * ## ⚠ The exact trigger is NOT established — treat the rule as unknown
 *
 * An earlier version of this comment asserted "4+ concurrent multi-row queries
 * deadlock" as settled. **`getHomeHandler` refutes that**: it fans out SIXTEEN
 * concurrent reads, several of them multi-row (`dailyVolume`, `getRecentPRs`,
 * `HabitRepository.list`, `getTodaysTraining`), and at `max: 1` it worked fine
 * in production. So concurrency-above-3 is not sufficient on its own.
 *
 * ⚠ **And I do not have a replacement rule.** The obvious candidate is
 * result-set SIZE, but the evidence I first cited for it was wrong:
 * `HabitRepository.list` is a bare `.select()` over a 7-day window with **no
 * LIMIT**, so an active user with several habits returns 40+ rows — more than
 * loadout's 29. "Home's results are smaller" does not hold, and I am not
 * substituting another guess for it.
 *
 * **Do not derive a safety rule from this comment.** What is solid, and all that
 * is solid: `max: 1` reproducibly deadlocks a real endpoint, and `max >= 2`
 * reproducibly does not.
 *
 * ## The invariant that DOES follow, and it is not "max >= fan-out width"
 *
 * postgres.js round-robins rather than serialising — `go(busy.shift(), query)`
 * then `move(c, busy)` pushes the connection to the back (`src/index.js` ~:339).
 * So concurrency per connection is `ceil(concurrent_queries / DB_POOL_MAX)`, and
 * raising `max` DIVIDES per-connection load rather than capping fan-out. At
 * `max: 4`, `getHomeHandler`'s 16 land 4-per-connection and `getDashboard`'s ~12
 * land 3. Widening either fan-out raises per-connection concurrency again.
 *
 * ## Connection footprint — honestly
 *
 * `max` is a ceiling on SOCKETS, not a preallocation: postgres.js builds `max`
 * Connection objects up front (`src/index.js` ~:65) but only dials on demand
 * (`connect(closed.shift(), query)`). It does NOT follow that containers hold
 * ~1 socket, and an earlier version of this comment claimed that. Home and
 * dashboard fan out 12-16 wide, so any container serving them opens all four on
 * its first real request, and `idle_timeout` defaults to null — they are then
 * held until `max_lifetime` (a random 30-60 min). Steady state is ~4 sockets per
 * warm container.
 *
 * ⚠ Whether that totals ~40 or ~4,000 depends on a number that is NOT in this
 * repo — nothing here sets reserved concurrency, so it is the AWS account quota.
 * Measured 2026-07-29 on `ess-dev` / eu-west-2 it is **10**, not the AWS default
 * of 1000, which is the only reason ~40 is the right figure:
 *
 *     aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions
 *
 * Re-check it before relying on the arithmetic; raise the quota and this
 * multiplies. The bound that holds regardless is Supavisor's
 * `default_pool_size` — it multiplexes, so the DB-side limit is not client count.
 *
 * ⚠ Do not lower this to 1 as connection hygiene. If the per-container footprint
 * ever needs bounding, add `idle_timeout` — do not take the ceiling away.
 *
 * ## Where the numbers came from
 *
 * The timings, the 7-calls/0-successes history and home's production latency were
 * measured live against staging (CloudWatch + API Gateway access logs + probe
 * scripts run from a workstation) and are NOT reproducible from this repo. They
 * are recorded in PR #335 and in
 * `memory/reference_postgresjs_max1_concurrency_deadlock.md`. Everything cited
 * from `postgres@3.4.9`'s source, and every fan-out count, IS checkable here.
 */
export const DB_POOL_MAX = 4;

/**
 * The driver options, exported as one object so tests assert the VALUE that
 * reaches postgres.js rather than scraping this file's source for a literal.
 *
 * ⚠ `satisfies` is load-bearing, not decoration. Extracting the inline literal
 * into a variable silently DROPPED excess-property checking: `postgres.Options`
 * has no index signature, so `postgres(url, { idle_timout: 5 })` was a compile
 * error before and became legal the moment it moved here — the driver would fall
 * through to its default and misconfigure silently. In a file whose whole subject
 * is a silent misconfiguration costing a feature, that is not a trade to make.
 * `satisfies` restores the check while keeping the literal types the tests read.
 */
export const DB_CLIENT_OPTIONS = {
  prepare: false,
  max: DB_POOL_MAX,
  ssl: "require",
} as const satisfies NonNullable<Parameters<typeof postgres>[1]>;

/**
 * Create a Drizzle client backed by `postgres.js` over TCP.
 *
 * Database is Supabase Postgres. We previously used Drizzle's `neon-http`
 * driver, which speaks Neon's proprietary HTTP serverless protocol — that
 * does NOT work against Supabase and produced opaque 500s on every query.
 *
 * Connection-string guidance for Lambda:
 *
 *   Use Supabase's **Transaction-mode pooler** (port 6543), not the direct
 *   connection (5432). Each Lambda invocation is short-lived and the pooler
 *   multiplexes connections at the transaction level, which is the only
 *   mode that survives Lambda scale-out without exhausting the server's
 *   connection limit. Pooler URL shape:
 *
 *     postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Driver options:
 *
 *   - `prepare: false` — required for pgbouncer in Transaction mode. Prepared
 *     statements persist past the pooled connection's transaction boundary,
 *     and pgbouncer will serve a later query on a different backend where
 *     the prepared plan doesn't exist. Disabling prepared statements sends
 *     each query as a one-shot simple query instead.
 *
 *   - `max: DB_POOL_MAX` (4) — ⚠ **NOT 1.** See that constant for the whole
 *     story; the short version is that a single connection deadlocks under
 *     concurrent multi-row reads and it cost this product a feature that never
 *     once worked.
 *
 *   - `ssl: "require"` — the Supabase pooler enforces SSL ("Enforce SSL on
 *     incoming connections" is on), so a plain connection is rejected with
 *     `FATAL: SSL connection is required (ESSLREQUIRED)`. The pooler
 *     connection string doesn't carry `?sslmode=require`, so we set it here
 *     explicitly — this covers every consumer (the Lambda AND the seed
 *     scripts) regardless of the URL. `"require"` encrypts without CA
 *     verification, which is the Supabase-documented setting for postgres.js.
 */
export function createDb(databaseUrl?: string) {
  const url = databaseUrl ?? getDatabaseUrl();
  const sql = postgres(url, DB_CLIENT_OPTIONS);
  return drizzle(sql, { schema });
}

/** Singleton used in Lambda handlers (one per cold start). */
let _db: ReturnType<typeof createDb> | null = null;

export function getDb(): ReturnType<typeof createDb> {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

export type Db = ReturnType<typeof createDb>;
