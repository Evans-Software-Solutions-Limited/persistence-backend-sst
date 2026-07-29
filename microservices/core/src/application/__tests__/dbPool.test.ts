import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_CLIENT_OPTIONS, DB_POOL_MAX } from "@persistence/db/client";

/**
 * The connection-pool invariant, guarded in code because a comment could not.
 *
 * `packages/db/src/client.ts` shipped `max: 1` for two years on a rationale that
 * was true and beside the point: "a Lambda container handles one request at a
 * time, so there's no upside to a per-container pool." Concurrency INSIDE a
 * single request — `Promise.all`, of which this codebase has ~20 — was never
 * considered.
 *
 * At `max: 1` the four reads `POST /workouts/:id/loadout/preview` fires under
 * `Promise.all` deadlock (measured: 4/4 hung; `max: 2` 0/4). That endpoint never
 * once succeeded — 7 calls, 0 x 200, every one a 29 s Lambda timeout with no
 * logs, no error, and nothing in `pg_stat_statements` because the queries never
 * reach Postgres.
 *
 * ⚠ A unit test cannot reproduce a driver-level deadlock. What it can do is stop
 * the one-character edit that reintroduces it — and `max: 1` reads like
 * connection hygiene, which is exactly why prose was not enough.
 */

describe("DB_POOL_MAX", () => {
  it("is at least 2, or concurrent multi-row reads deadlock", () => {
    // The floor. At 1 the failure is SILENT — nothing thrown, nothing logged, no
    // slow query recorded — which is how it survived two misdiagnoses.
    expect(DB_POOL_MAX).toBeGreaterThanOrEqual(2);
  });

  it("is bounded above, because sockets are held until max_lifetime", () => {
    // ⚠ Two-sided on purpose. The first version of this file asserted only a
    // lower bound, so `DB_POOL_MAX = 500` passed everything — for a value whose
    // risk is symmetric (too low deadlocks, too high multiplies the
    // per-container socket footprint under Lambda scale-out) that is half a
    // guard.
    //
    // `idle_timeout` defaults to null, so a warm container holds every socket it
    // opens until `max_lifetime` (30-60 min). 10 is postgres.js's own default
    // and also the current Lambda account concurrency limit.
    expect(DB_POOL_MAX).toBeLessThanOrEqual(10);
  });
});

describe("DB_CLIENT_OPTIONS", () => {
  it("carries the pool ceiling, so the constant is not decorative", () => {
    expect(DB_CLIENT_OPTIONS.max).toBe(DB_POOL_MAX);
  });

  it("keeps prepare:false and ssl:require — both load-bearing for the pooler", () => {
    // `prepare: false` is mandatory for pgbouncer in transaction mode: prepared
    // statements outlive the pooled transaction and the next query lands on a
    // backend with no such plan. Without `ssl: "require"` the pooler rejects the
    // connection outright (ESSLREQUIRED) — the connection string carries no
    // sslmode, so it has to be set here.
    expect(DB_CLIENT_OPTIONS).toMatchObject({
      prepare: false,
      ssl: "require",
    });
  });
});

describe("createDb wiring", () => {
  // ⚠ Read from source, and only for the one thing a value cannot prove: that
  // `createDb` actually HANDS these options to the driver. Exporting
  // `DB_CLIENT_OPTIONS` and then inlining `{ max: 1 }` at the call site would
  // satisfy every assertion above.
  //
  // `vi.mock("postgres")` cannot do this: `packages/db` resolves `postgres` from
  // its OWN node_modules and core's vitest config aliases only `drizzle-orm` and
  // `@persistence/db`, so the mock and the import are different module instances
  // and the real driver gets constructed.
  //
  // The regex is anchored on the call, so no comment can satisfy it — an earlier
  // version stripped comments instead, which broke on the docstring's own
  // measurement table and would have corrupted any future line containing `//`.
  const source = readFileSync(
    join(__dirname, "../../../../../packages/db/src/client.ts"),
    "utf8",
  );

  it("passes the shared options object to postgres.js", () => {
    expect(source).toMatch(/postgres\(\s*url,\s*DB_CLIENT_OPTIONS\s*\)/);
  });

  it("still uses postgres.js over TCP, never Neon's HTTP driver", () => {
    // The original incident in this file: `neon-http` speaks Neon's proprietary
    // protocol, does not work against Supabase, and 500'd every query. Matched on
    // the import specifically — the docstring names `neon-http` in a warning.
    expect(source).toMatch(/from "drizzle-orm\/postgres-js"/);
    expect(source).not.toMatch(/from "drizzle-orm\/neon-http"/);
  });
});
