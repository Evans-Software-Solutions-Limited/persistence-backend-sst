import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The uniqueness on `analytics_events` must stay scoped BY EVENT NAME.
 *
 * Not a style rule. While the index was `UNIQUE (event_id)` alone, the founding
 * Stripe webhook's `purchase` insert collided with the `checkout_started` row
 * that had claimed the buyer's shared event id half an hour earlier, and
 * `ON CONFLICT DO NOTHING` discarded it without a word. Every server-side
 * `Purchase` was lost while the browser pixel kept firing, so Events Manager
 * read "Meta pixel only" for a conversion that had certainly happened. Proven
 * against the live staging database on 2026-09-09: two completed checkouts held
 * a `checkout_started` row and no `purchase`.
 *
 * One checkout reuses ONE id across both of its events on purpose — Meta dedups
 * per (event_name, event_id), so the browser and server copies of the SAME named
 * event pair up, while two DIFFERENTLY named events may share the id.
 *
 * Asserted against the FILES, not a database: every test here that touches
 * `analytics_events` runs against a mocked `getDb` and cannot see an index at
 * all, which is exactly why the original defect shipped green.
 */
const ROOT = resolve(process.cwd(), "../..");
const SCHEMA = resolve(ROOT, "packages/db/src/schema.ts");
const MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20260909120000_analytics_events_event_id_per_name.sql",
);

/**
 * The table's definition with ALL whitespace stripped, so the assertions below
 * survive Prettier wrapping a long `uniqueIndex(...)` call across four lines —
 * or later un-wrapping it back onto one. Matching the formatted shape rather
 * than the meaning would make this test fail on a reformat and pass on a
 * revert, which is precisely backwards.
 */
function analyticsEventsBlock(): string {
  const src = readFileSync(SCHEMA, "utf8");
  const start = src.indexOf("export const analyticsEvents");
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("\n);", start)).replace(/\s+/g, "");
}

describe("analytics_events uniqueness is scoped by event name", () => {
  it("declares the unique index on BOTH event name and event id", () => {
    expect(analyticsEventsBlock()).toContain(
      'uniqueIndex("analytics_events_name_event_id_key").on(t.eventName,t.eventId',
    );
  });

  it("no longer declares a unique index on event_id alone", () => {
    // The precise shape of the bug, guarded as its own case so a revert reads
    // as this failure rather than a vague mismatch.
    expect(analyticsEventsBlock()).not.toContain(
      'uniqueIndex("analytics_events_event_id_key")',
    );
  });

  it("has a migration creating the new index and dropping the old one", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_name_event_id_key\s+ON analytics_events \(event_name, event_id\)\s+WHERE event_id IS NOT NULL;/,
    );
    expect(sql).toMatch(/DROP INDEX IF EXISTS analytics_events_event_id_key;/);
  });

  it("keeps the NULL event_id exemption, so id-less events may still repeat", () => {
    expect(readFileSync(MIGRATION, "utf8")).toContain(
      "WHERE event_id IS NOT NULL",
    );
  });
});
