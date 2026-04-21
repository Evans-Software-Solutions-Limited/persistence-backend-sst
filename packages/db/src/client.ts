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
 *   - `max: 1` — a Lambda container is single-threaded and handles one
 *     request at a time, so there's no upside to a per-container pool.
 *     Keeping it at 1 avoids idle connections sitting open between invokes.
 */
export function createDb(databaseUrl?: string) {
  const url = databaseUrl ?? getDatabaseUrl();
  const sql = postgres(url, { prepare: false, max: 1 });
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
