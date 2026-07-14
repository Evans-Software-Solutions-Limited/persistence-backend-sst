# Supabase Prod Setup — Decisions Log

Locked with Brad on 2026-07-14. Rationale kept so future sessions don't relitigate.

| #   | Decision              | Choice                                                                               | Why                                                                                                                                                                                                                                       |
| --- | --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Project strategy      | **Two fresh projects; retire the old free one only after cutover is proven**         | Old project has just 4 test users + reseedable reference data — nothing real to preserve. Fresh = clean baseline (no RLS/grant drift). Retire-after-proven avoids a gap.                                                                  |
| 2   | Org layout            | **Staging in the existing free org; prod in a NEW org upgraded to Pro**              | Supabase bills per-org (one plan/org). Free-staging + Pro-prod can't coexist in one org, so prod needs its own org. Per-project-ref wiring is org-agnostic.                                                                               |
| 3   | Prod plan             | **Pro, daily backups only (PITR DROPPED)**                                           | Pro ($25/mo) never pauses + daily backups. PITR **dropped 2026-07-14** — the add-on at the required compute worked out ~$100/mo, too much pre-launch. Revisit once revenue justifies it.                                                  |
| 4   | Prod compute          | **Micro** (Pro default)                                                              | Brad's call 2026-07-14 — keep cost down; Micro is fine for early launch and scales up live with no downtime. (PITR would have needed ≥ Small; moot now PITR is dropped.)                                                                  |
| 5   | Staging plan          | **Free**                                                                             | Save spend for prod. Pauses after ~1wk idle but CI merges keep it warm + it un-pauses on demand.                                                                                                                                          |
| 6   | Region                | **`eu-west-2` (London)** both                                                        | Match the Lambda region (`infra` deploys to eu-west-2) to minimise Lambda↔DB latency.                                                                                                                                                     |
| 7   | Data-exposure posture | **Disable the Data API (remove `public` from exposed schemas); keep RLS-off intent** | Clients use Supabase only for Auth; only the SST Lambda (pooled conn) touches Postgres. Closing PostgREST removes the anon-key exposure regardless of RLS-policy correctness. Do NOT reflexively enable RLS on `get_advisors` complaints. |

## Corrections to the brief (surfaced during audit)

- Brief said "RLS is OFF" — actually **59/60 public tables have RLS enabled**; the repo
  moved _toward_ RLS. Exposure is via `anon`/`authenticated` grants + one RLS-off table
  (`revenuecat_webhook_events`), closed by disabling the Data API.
- Brief said update `infra/domains` for `SUPABASE_URL` — it's actually **hardcoded** in
  `packages/api-utils/src/domains/domain-config.ts` (+ a test) and **mobile `eas.json`**;
  `SUPABASE_URL` is not a GitHub secret.
- Brief said seed populates `serving_quantity` — the script _maps_ it, but the committed
  OFF dump doesn't carry it and `refreshOffDump.sh` didn't project it. Fixed in this
  workstream (`refreshOffDump.sh` now `TRY_CAST`s `serving_quantity`); dump must be
  regenerated + committed before the prod seed.

## Open (Brad-gated) before execution can continue

- Phase 1: Brad creates both projects/org + billing, then hands Claude the two
  **non-secret** project refs + anon keys, and loads the **secret** values into the
  GitHub `staging` / `Production` Environments.
