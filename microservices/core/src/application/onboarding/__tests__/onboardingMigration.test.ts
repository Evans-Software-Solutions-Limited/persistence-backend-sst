import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../../../../supabase/migrations/20260901120000_onboarding_states.sql",
  ),
  "utf8",
);

describe("onboarding states migration", () => {
  it("is additive, cascades account deletion, and validates every vocabulary", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS");
    expect(migration).toContain(
      "REFERENCES public.profiles(id) ON DELETE CASCADE",
    );
    expect(migration).toContain("onboarding_states_completed_pages_check");
    expect(migration).toContain("onboarding_states_skipped_pages_check");
    expect(migration).toContain("onboarding_states_intent_keys_check");
  });

  it("keeps the table backend-only with RLS and explicit client revocation", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.onboarding_states FROM anon, authenticated",
    );
    expect(migration).not.toMatch(/CREATE POLICY/);
  });
});
